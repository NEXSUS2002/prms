// The unified timeline (FR8), clinical entry with the Contraindication Engine (FR3),
// the Immutable Addendum (FR4), nursing observations (FR7) and admissions.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/db/index.server";
import {
  admissions, clinicalRecords, departments, disputes, hospitals, labRequests, labResults, patients, users,
  type Medication, type Vitals,
} from "~/db/schema";
import { checkContraindications, type CheckResult } from "~/lib/engine";
import { diagnosisName, drugName, isDiagnosis, isDrug } from "~/lib/catalogue";
import { type Actor, assertVerified, requireRole } from "./actor.server";
import { hexHash, idHash, relay } from "./chain.server";
import { doctorCanRead } from "./consent.server";
import { badRequest, canonicalJson, decryptFor, forbidden, newId, notFound, sha256 } from "./util.server";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const GENESIS = "0".repeat(64);

async function loadPatient(patientId: string) {
  const [row] = await db
    .select({ p: patients, name: users.name, wallet: users.publicKey })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(patients.id, patientId));
  if (!row) throw notFound("Patient not found.");
  return row;
}

const header = (row: Awaited<ReturnType<typeof loadPatient>>) => ({
  id: row.p.id, code: row.p.code, name: row.name, sex: row.p.sex, dateOfBirth: row.p.dateOfBirth,
  bloodGroup: row.p.bloodGroup, genotype: row.p.genotype, wallet: row.wallet,
});

// ---------------------------------------------------------------- hash chain
export type NewRecord = {
  id?: string;
  patientId: string;
  hospitalId: string;
  authorId: string;
  recordType: "consultation" | "observation" | "addendum";
  diagnosis?: string[];
  prescribedMedications?: Medication[];
  notes?: string;
  vitals?: Vitals | null;
  contradictsRecordId?: string | null;
  timestamp?: Date;
  status?: string;
};

/** Builds the next link of a patient's chain: hash = SHA-256(previous hash + the record's content). */
export async function buildRecord(input: NewRecord) {
  const [last] = await db
    .select({ recordHash: clinicalRecords.recordHash })
    .from(clinicalRecords)
    .where(eq(clinicalRecords.patientId, input.patientId))
    .orderBy(desc(clinicalRecords.seq))
    .limit(1);
  const previousRecordHash = last?.recordHash ?? GENESIS;
  const row = {
    id: input.id ?? newId("rec"),
    patientId: input.patientId,
    hospitalId: input.hospitalId,
    authorId: input.authorId,
    recordType: input.recordType,
    diagnosis: input.diagnosis ?? [],
    prescribedMedications: input.prescribedMedications ?? [],
    notes: input.notes ?? "",
    vitals: input.vitals ?? null,
    timestamp: input.timestamp ?? new Date(),
    contradictsRecordId: input.contradictsRecordId ?? null,
  };
  const recordHash = sha256(previousRecordHash + canonicalJson({ ...row, timestamp: row.timestamp.toISOString() }));
  return { ...row, previousRecordHash, recordHash, status: input.status ?? "ACTIVE" };
}

/** Anchors the hash on the ledger, then stores the record. An entry that cannot be anchored is not saved. */
async function saveAnchored(input: NewRecord, anchor: (row: Awaited<ReturnType<typeof buildRecord>>) => Promise<string>) {
  const row = await buildRecord(input);
  const txHash = await anchor(row);
  await db.insert(clinicalRecords).values({ ...row, txHash });
  return { ...row, txHash };
}

const anchorPlain = (row: { id: string; recordHash: string; hospitalId: string }) =>
  relay("anchorRecord", [idHash(row.id), hexHash(row.recordHash), idHash(row.hospitalId)]);

// ---------------------------------------------------------------- who may read
async function assertCanRead(actor: Actor, patient: Awaited<ReturnType<typeof loadPatient>>) {
  if (actor.role === "patient") {
    if (actor.patientId !== patient.p.id) throw forbidden("You can read only your own record.");
    return;
  }
  if (actor.role === "doctor") {
    if (await doctorCanRead(actor, patient.wallet)) return;
    throw forbidden("You do not have access to this patient's record. Request access, or use the emergency override.");
  }
  // Nurses read through careSummary; technicians, administrators and the registrar never read a record.
  throw forbidden("Your role cannot read patient records.");
}

async function nurseAdmission(actor: Actor, patientId: string) {
  if (actor.role !== "nurse" || !actor.hospitalId || !actor.working?.departmentId) return null;
  if (actor.working.status !== "ACTIVE") return null;
  const [a] = await db
    .select()
    .from(admissions)
    .where(and(eq(admissions.patientId, patientId), eq(admissions.hospitalId, actor.hospitalId), eq(admissions.departmentId, actor.working.departmentId), eq(admissions.status, "ADMITTED")));
  return a ?? null;
}

// ---------------------------------------------------------------- timeline (FR8)
export async function getTimeline(actor: Actor, patientId: string) {
  const patient = await loadPatient(patientId);
  // The access check comes first and on its own: no clinical row is read until the contract has said yes.
  await assertCanRead(actor, patient);
  // The three reads are independent, so they are sent together (one round trip to the database instead of three).
  const [recs, labs, [admission]] = await Promise.all([
    db
      .select({ r: clinicalRecords, author: users.name, authorRole: users.role, hospital: hospitals.name, city: hospitals.city })
      .from(clinicalRecords)
      .innerJoin(users, eq(users.id, clinicalRecords.authorId))
      .innerJoin(hospitals, eq(hospitals.id, clinicalRecords.hospitalId))
      .where(eq(clinicalRecords.patientId, patientId))
      .orderBy(desc(clinicalRecords.timestamp)),
    db
      .select({ q: labRequests, res: labResults, doctor: users.name, hospital: hospitals.name, department: departments.name })
      .from(labRequests)
      .innerJoin(users, eq(users.id, labRequests.orderingPhysicianId))
      .innerJoin(hospitals, eq(hospitals.id, labRequests.targetHospitalId))
      .innerJoin(departments, eq(departments.id, labRequests.departmentId))
      .leftJoin(labResults, eq(labResults.requestId, labRequests.id))
      .where(eq(labRequests.patientId, patientId))
      .orderBy(desc(labRequests.orderedAt)),
    db
      .select({ a: admissions, hospital: hospitals.name, ward: departments.name })
      .from(admissions)
      .innerJoin(hospitals, eq(hospitals.id, admissions.hospitalId))
      .innerJoin(departments, eq(departments.id, admissions.departmentId))
      .where(and(eq(admissions.patientId, patientId), eq(admissions.status, "ADMITTED"))),
  ]);
  const hospitalsSeen = new Map<string, string>();
  for (const r of recs) hospitalsSeen.set(r.r.hospitalId, r.hospital);
  return {
    patient: header(patient),
    hospitals: [...hospitalsSeen].map(([id, name]) => ({ id, name })),
    records: recs.map(({ r, author, authorRole, hospital, city }) => ({
      id: r.id, type: r.recordType, timestamp: iso(r.timestamp)!, hospitalId: r.hospitalId, hospital, city, author, authorRole,
      diagnosis: r.diagnosis.map((d) => ({ id: d, name: diagnosisName(d) })),
      medications: r.prescribedMedications.map((m) => ({ ...m, name: drugName(m.drug) })),
      notes: r.notes, vitals: r.vitals, status: r.status, contradictsRecordId: r.contradictsRecordId, txHash: r.txHash, recordHash: r.recordHash,
    })),
    labs: labs.map(({ q, res, doctor, hospital, department }) => {
      // A result is encrypted for the ordering physician: he or she, and the patient, can open it.
      const mayOpen = actor.role === "patient" || actor.userId === q.orderingPhysicianId;
      return {
        id: q.id, code: q.code, investigation: q.investigation, department, hospital, orderedBy: doctor, orderedAt: iso(q.orderedAt)!,
        status: q.status === "FULFILLED" ? "FULFILLED" : q.expiresAt.getTime() <= Date.now() ? "EXPIRED" : "PENDING",
        uploadedAt: iso(res?.uploadedAt ?? null), txHash: res?.txHash ?? null,
        result: res && mayOpen ? safeDecrypt(q.orderingPhysicianId, res.resultPayload) : null,
        sealed: Boolean(res) && !mayOpen,
      };
    }),
    admission: admission
      ? { id: admission.a.id, hospital: admission.hospital, hospitalId: admission.a.hospitalId, ward: admission.ward, bed: admission.a.bed, reason: admission.a.reason, admittedAt: iso(admission.a.admittedAt)! }
      : null,
  };
}

function safeDecrypt(physicianId: string, payload: string): string {
  try {
    return decryptFor(physicianId, payload);
  } catch {
    return "This result could not be decrypted with the current server key.";
  }
}

// ---------------------------------------------------------------- clinical entry with validation (FR3)
export type EntryInput = {
  diagnoses: string[];
  notes: string;
  medications: Medication[];
  admission?: { departmentId: string; bed?: string; reason?: string } | null;
};

function cleanEntry(input: EntryInput) {
  const diagnoses = [...new Set((input.diagnoses ?? []).filter(Boolean))];
  const medications = (input.medications ?? []).filter((m) => m && m.drug);
  for (const d of diagnoses) if (!isDiagnosis(d)) throw badRequest(`Unknown diagnosis: ${d}. Pick one from the list.`);
  for (const m of medications) if (!isDrug(m.drug)) throw badRequest(`Unknown medicine: ${m.drug}. Pick one from the list.`);
  const notes = (input.notes ?? "").trim();
  if (!diagnoses.length && !notes && !medications.length) throw badRequest("Enter a diagnosis, notes or a prescription.");
  return {
    diagnoses,
    notes,
    medications: medications.map((m) => ({ drug: m.drug, dose: (m.dose ?? "").trim(), frequency: (m.frequency ?? "").trim(), duration: (m.duration ?? "").trim(), ongoing: Boolean(m.ongoing) })),
  };
}

async function runEngine(patientId: string, drugs: string[], diagnoses: string[]) {
  // The whole history, from every hospital: this is what makes the check cross-facility.
  const history = await db
    .select({ id: clinicalRecords.id, status: clinicalRecords.status, diagnosis: clinicalRecords.diagnosis, meds: clinicalRecords.prescribedMedications, timestamp: clinicalRecords.timestamp, hospital: hospitals.name, city: hospitals.city })
    .from(clinicalRecords)
    .innerJoin(hospitals, eq(hospitals.id, clinicalRecords.hospitalId))
    .where(eq(clinicalRecords.patientId, patientId))
    .orderBy(asc(clinicalRecords.timestamp));
  const result = checkContraindications(
    history.map((h) => ({ id: h.id, status: h.status, diagnosis: h.diagnosis, prescribed_medications: h.meds.map((m) => ({ drug: m.drug, ongoing: m.ongoing })) })),
    drugs,
    diagnoses,
  );
  return { result, history };
}

function describeConflict(result: Extract<CheckResult, { allowed: false }>, history: Awaited<ReturnType<typeof runEngine>>["history"]) {
  const src = history.find((h) => h.id === result.sourceRecordId);
  return {
    ruleId: result.ruleId,
    type: result.type,
    drug: result.drug,
    drugName: drugName(result.drug),
    conflictsWith: result.conflictsWith,
    conflictsWithName: result.type === "DRUG_DIAGNOSIS_CONFLICT" ? diagnosisName(result.conflictsWith) : drugName(result.conflictsWith),
    reason: result.reason,
    sourceDocument: result.source.document,
    sourcePage: result.source.printed_page,
    // Where the conflicting item was recorded; null when it is part of this same submission.
    recordedAt: src ? iso(src.timestamp) : null,
    recordedAtHospital: src ? `${src.hospital}, ${src.city}` : null,
    recordId: src?.id ?? null,
  };
}

async function doctorWithAccess(actor: Actor, patientId: string) {
  requireRole(actor, "doctor");
  await assertVerified(actor);
  const patient = await loadPatient(patientId);
  await assertCanRead(actor, patient);
  return patient;
}

/** The check alone, without saving: lets the form show a conflict before the doctor submits. */
export async function checkPrescription(actor: Actor, patientId: string, input: EntryInput) {
  await doctorWithAccess(actor, patientId);
  const e = cleanEntry(input);
  const { result, history } = await runEngine(patientId, e.medications.map((m) => m.drug), e.diagnoses);
  const active = history.filter((h) => h.status === "ACTIVE");
  return {
    allowed: result.allowed,
    conflict: result.allowed ? null : describeConflict(result, history),
    checkedRecords: active.length,
    checkedHospitals: new Set(active.map((h) => h.hospital)).size,
  };
}

export async function createEntry(actor: Actor, patientId: string, input: EntryInput) {
  await doctorWithAccess(actor, patientId);
  const e = cleanEntry(input);
  const { result, history } = await runEngine(patientId, e.medications.map((m) => m.drug), e.diagnoses);
  // Algorithm 1: a conflict returns false and nothing is written.
  if (!result.allowed) return { saved: false as const, conflict: describeConflict(result, history) };

  let ward: typeof departments.$inferSelect | null = null;
  if (input.admission?.departmentId) {
    const [d] = await db.select().from(departments).where(eq(departments.id, input.admission.departmentId));
    if (!d || d.hospitalId !== actor.hospitalId || d.type !== "WARD") throw badRequest("Choose a ward of the hospital you are working at.");
    const [open] = await db.select().from(admissions).where(and(eq(admissions.patientId, patientId), eq(admissions.status, "ADMITTED")));
    if (open) throw badRequest("This patient is already admitted. Discharge the patient before a new admission.");
    ward = d;
  }
  const row = await saveAnchored(
    { patientId, hospitalId: actor.hospitalId!, authorId: actor.userId, recordType: "consultation", diagnosis: e.diagnoses, prescribedMedications: e.medications, notes: e.notes },
    anchorPlain,
  );
  if (ward) {
    await db.insert(admissions).values({
      id: newId("adm"), patientId, hospitalId: actor.hospitalId!, departmentId: ward.id, bed: input.admission?.bed?.trim() || null,
      reason: input.admission?.reason?.trim() || e.diagnoses.map(diagnosisName).join(", ") || null, admittedBy: actor.userId,
    });
  }
  return { saved: true as const, recordId: row.id, txHash: row.txHash, recordHash: row.recordHash, admittedTo: ward?.name ?? null };
}

export async function dischargePatient(actor: Actor, admissionId: string) {
  requireRole(actor, "doctor");
  await assertVerified(actor);
  const [a] = await db.select().from(admissions).where(eq(admissions.id, admissionId));
  if (!a || a.status !== "ADMITTED") throw notFound("Admission not found.");
  if (a.hospitalId !== actor.hospitalId) throw forbidden("The patient is admitted at another hospital.");
  await db.update(admissions).set({ status: "DISCHARGED", dischargedAt: new Date() }).where(eq(admissions.id, a.id));
  return { ok: true };
}

/** What the entry form needs: the wards of the working hospital and what the engine will check against. */
export async function entryContext(actor: Actor, patientId: string) {
  const patient = await doctorWithAccess(actor, patientId);
  const wards = await db.select().from(departments).where(and(eq(departments.hospitalId, actor.hospitalId!), eq(departments.type, "WARD")));
  const history = await db
    .select({ r: clinicalRecords, hospital: hospitals.name })
    .from(clinicalRecords)
    .innerJoin(hospitals, eq(hospitals.id, clinicalRecords.hospitalId))
    .where(eq(clinicalRecords.patientId, patientId))
    .orderBy(asc(clinicalRecords.timestamp));
  const active = history.filter((h) => h.r.status === "ACTIVE");
  const dx = new Map<string, { name: string; at: string; hospital: string }>();
  const meds = new Map<string, string>();
  for (const h of active) {
    for (const d of h.r.diagnosis) if (!dx.has(d)) dx.set(d, { name: diagnosisName(d), at: iso(h.r.timestamp)!, hospital: h.hospital });
    for (const m of h.r.prescribedMedications) if (m.ongoing) meds.set(m.drug, drugName(m.drug));
  }
  return {
    patient: header(patient),
    wards: wards.map((w) => ({ id: w.id, name: w.name })),
    activeDiagnoses: [...dx.values()],
    ongoingMedication: [...meds.values()],
    disputedCount: history.length - active.length,
  };
}

// ---------------------------------------------------------------- Immutable Addendum (FR4)
export async function disputeRecord(actor: Actor, recordId: string, input: { correctedDiagnoses: string[]; notes: string }) {
  requireRole(actor, "doctor");
  const [original] = await db.select().from(clinicalRecords).where(eq(clinicalRecords.id, recordId));
  if (!original) throw notFound("Record not found.");
  await doctorWithAccess(actor, original.patientId);
  if (original.status !== "ACTIVE") throw badRequest("This record has already been disputed.");
  if (original.recordType === "addendum") throw badRequest("A correction cannot itself be disputed here; dispute the entry it replaced.");
  const corrected = [...new Set((input.correctedDiagnoses ?? []).filter(Boolean))];
  for (const d of corrected) if (!isDiagnosis(d)) throw badRequest(`Unknown diagnosis: ${d}.`);
  const notes = (input.notes ?? "").trim();
  if (notes.length < 10) throw badRequest("Explain the clinical reason for the dispute.");

  // The original is never edited or deleted. A new record points to it, and the original is only re-labelled.
  const addendum = await saveAnchored(
    { patientId: original.patientId, hospitalId: actor.hospitalId!, authorId: actor.userId, recordType: "addendum", diagnosis: corrected, notes, contradictsRecordId: original.id },
    (row) => relay("anchorAddendum", [idHash(original.id), idHash(row.id), hexHash(row.recordHash), idHash(row.hospitalId)]),
  );
  await db.update(clinicalRecords).set({ status: "DISPUTED" }).where(eq(clinicalRecords.id, original.id));
  const disputeId = newId("dsp");
  await db.insert(disputes).values({ id: disputeId, originalRecordId: original.id, newAddendumId: addendum.id, practitionerId: actor.userId, txHash: addendum.txHash });
  return { disputeId, addendumId: addendum.id, originalRecordId: original.id, txHash: addendum.txHash };
}

// ---------------------------------------------------------------- nursing (FR7)
export async function wardList(actor: Actor) {
  requireRole(actor, "nurse");
  if (!actor.hospitalId || !actor.working?.departmentId) throw forbidden("You are not assigned to a ward.");
  const rows = await db
    .select({ a: admissions, p: patients, name: users.name })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(users, eq(users.id, patients.userId))
    .where(and(eq(admissions.hospitalId, actor.hospitalId), eq(admissions.departmentId, actor.working.departmentId), eq(admissions.status, "ADMITTED")))
    .orderBy(asc(admissions.bed));
  const ids = rows.map((r) => r.p.id);
  const [obs, pending] = ids.length
    ? await Promise.all([
        db.select().from(clinicalRecords).where(and(inArray(clinicalRecords.patientId, ids), eq(clinicalRecords.recordType, "observation"))).orderBy(desc(clinicalRecords.timestamp)),
        db
          .select({ q: labRequests, department: departments.name })
          .from(labRequests)
          .innerJoin(departments, eq(departments.id, labRequests.departmentId))
          .where(and(inArray(labRequests.patientId, ids), eq(labRequests.status, "PENDING"))),
      ])
    : [[], []];
  return {
    ward: actor.working.departmentName, hospital: actor.working.hospitalName, verified: actor.working.status === "ACTIVE",
    patients: rows.map((r) => {
      const last = obs.find((o) => o.patientId === r.p.id);
      return {
        patientId: r.p.id, code: r.p.code, name: r.name, bed: r.a.bed, reason: r.a.reason, admittedAt: iso(r.a.admittedAt)!,
        lastObservationAt: iso(last?.timestamp ?? null), lastVitals: last?.vitals ?? null,
      };
    }),
    awaited: pending
      .filter((x) => x.q.expiresAt.getTime() > Date.now())
      .map((x) => ({ code: x.q.code, investigation: x.q.investigation, department: x.department, patient: rows.find((r) => r.p.id === x.q.patientId)?.name ?? "" })),
  };
}

/** The care-relevant portion of a record: what a nurse needs at the bedside and no more. */
export async function careSummary(actor: Actor, patientId: string) {
  requireRole(actor, "nurse");
  const admission = await nurseAdmission(actor, patientId);
  if (!admission) throw forbidden("This patient is not admitted to your ward.");
  const [patient, recs] = await Promise.all([
    loadPatient(patientId),
    db
      .select({ r: clinicalRecords, author: users.name })
      .from(clinicalRecords)
      .innerJoin(users, eq(users.id, clinicalRecords.authorId))
      .where(eq(clinicalRecords.patientId, patientId))
      .orderBy(desc(clinicalRecords.timestamp)),
  ]);
  const active = recs.filter((x) => x.r.status === "ACTIVE");
  const dx = new Set<string>();
  const meds = new Map<string, Medication>();
  const allergyNotes: string[] = [];
  for (const { r } of active) {
    r.diagnosis.forEach((d) => dx.add(d));
    for (const m of r.prescribedMedications) if (m.ongoing && !meds.has(m.drug)) meds.set(m.drug, m);
    for (const sentence of r.notes.split(/(?<=[.!?])\s+/)) if (/allerg/i.test(sentence) && !allergyNotes.includes(sentence)) allergyNotes.push(sentence);
  }
  return {
    patient: { id: patient.p.id, code: patient.p.code, name: patient.name, sex: patient.p.sex, dateOfBirth: patient.p.dateOfBirth, bloodGroup: patient.p.bloodGroup, genotype: patient.p.genotype },
    admission: { bed: admission.bed, reason: admission.reason, admittedAt: iso(admission.admittedAt)! },
    diagnoses: [...dx].map(diagnosisName),
    medications: [...meds.values()].map((m) => ({ name: drugName(m.drug), dose: m.dose, frequency: m.frequency })),
    allergyNotes,
    observations: recs
      .filter((x) => x.r.recordType === "observation")
      .slice(0, 12)
      .map((x) => ({ id: x.r.id, timestamp: iso(x.r.timestamp)!, author: x.author, vitals: x.r.vitals, notes: x.r.notes, txHash: x.r.txHash })),
  };
}

export type ObservationInput = { vitals: Partial<Record<keyof Vitals, string | number | null>>; notes: string };

function cleanVitals(v: ObservationInput["vitals"]): Vitals {
  const num = (x: unknown, lo: number, hi: number, label: string) => {
    if (x === null || x === undefined || x === "") return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < lo || n > hi) throw badRequest(`${label} must be between ${lo} and ${hi}.`);
    return n;
  };
  const bp = typeof v.blood_pressure === "string" && v.blood_pressure.trim() ? v.blood_pressure.trim() : null;
  if (bp && !/^\d{2,3}\/\d{2,3}$/.test(bp)) throw badRequest("Enter blood pressure as systolic/diastolic, for example 120/80.");
  return {
    temperature_c: num(v.temperature_c, 30, 45, "Temperature"),
    pulse_bpm: num(v.pulse_bpm, 20, 250, "Pulse"),
    respiratory_rate: num(v.respiratory_rate, 4, 80, "Respiratory rate"),
    blood_pressure: bp,
    spo2_percent: num(v.spo2_percent, 40, 100, "Oxygen saturation"),
  };
}

export async function recordObservation(actor: Actor, patientId: string, input: ObservationInput) {
  requireRole(actor, "nurse", "doctor");
  if (actor.role === "nurse") {
    await assertVerified(actor);
    if (!(await nurseAdmission(actor, patientId))) throw forbidden("This patient is not admitted to your ward.");
  } else {
    await doctorWithAccess(actor, patientId);
  }
  const vitals = cleanVitals(input.vitals ?? {});
  const notes = (input.notes ?? "").trim();
  if (!notes && Object.values(vitals).every((x) => x === null)) throw badRequest("Enter at least one vital sign or a note.");
  const row = await saveAnchored(
    { patientId, hospitalId: actor.hospitalId!, authorId: actor.userId, recordType: "observation", notes, vitals },
    anchorPlain,
  );
  return { recordId: row.id, txHash: row.txHash, timestamp: iso(row.timestamp)! };
}

/** Recomputes a patient's hash chain. Used by the tests and available to prove that no record was altered. */
export async function verifyChain(patientId: string) {
  const rows = await db.select().from(clinicalRecords).where(eq(clinicalRecords.patientId, patientId)).orderBy(asc(clinicalRecords.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const body = {
      id: r.id, patientId: r.patientId, hospitalId: r.hospitalId, authorId: r.authorId, recordType: r.recordType, diagnosis: r.diagnosis,
      prescribedMedications: r.prescribedMedications, notes: r.notes, vitals: r.vitals, timestamp: r.timestamp.toISOString(), contradictsRecordId: r.contradictsRecordId,
    };
    if (r.previousRecordHash !== prev || sha256(prev + canonicalJson(body)) !== r.recordHash) return { valid: false, brokenAt: r.id, count: rows.length };
    prev = r.recordHash;
  }
  return { valid: true, brokenAt: null, count: rows.length };
}
