// FR5, FR6 and FR11: requisitions, delegated tokens (Algorithm 4), the work queue and result upload.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "~/db/index.server";
import { departments, hospitals, labRequests, labResults, patients, users } from "~/db/schema";
import { testsFor, tokenHoursFor, tokenValidityLabel } from "~/lib/labCatalogue";
import { type Actor, assertVerified, requireRole } from "./actor.server";
import { hexHash, idHash, isTokenValidOnChain, relay } from "./chain.server";
import { doctorCanRead } from "./consent.server";
import { badRequest, decryptFor, encryptFor, forbidden, newId, nextCode, notFound, sha256 } from "./util.server";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Child token hash, as in Algorithm 4: SHA-256(parent requisition id + department + secret). */
export const childTokenHash = (parentId: string, departmentId: string, secret: string) => sha256(parentId + departmentId + secret);

// ---------------------------------------------------------------- doctor: where an order may go (FR11)
export async function labDestinations(actor: Actor) {
  requireRole(actor, "doctor");
  if (!actor.hospitalId) throw forbidden("You are not affiliated with a hospital.");
  const rows = await db
    .select({ d: departments, h: hospitals })
    .from(departments)
    .innerJoin(hospitals, eq(hospitals.id, departments.hospitalId))
    .where(and(eq(departments.type, "LABORATORY"), eq(departments.status, "ACTIVE"), eq(hospitals.status, "ACTIVE")))
    .orderBy(asc(hospitals.code), asc(departments.name));
  const byHospital = new Map<string, { id: string; name: string; city: string; own: boolean; departments: Array<{ id: string; name: string; validity: string; tests: ReturnType<typeof testsFor> }> }>();
  for (const { d, h } of rows) {
    const own = h.id === actor.hospitalId;
    // Another hospital's laboratory is offered only if that hospital's administrator has opened it to outside requisitions.
    if (!own && !d.acceptsOutsideRequisitions) continue;
    if (!byHospital.has(h.id)) byHospital.set(h.id, { id: h.id, name: h.name, city: h.city, own, departments: [] });
    byHospital.get(h.id)!.departments.push({ id: d.id, name: d.name, validity: tokenValidityLabel(d.name), tests: testsFor(d.name) });
  }
  return [...byHospital.values()].sort((a, b) => Number(b.own) - Number(a.own));
}

export type RequisitionInput = {
  targetHospitalId: string;
  items: Array<{ departmentId: string; investigation: string; specimen?: string }>;
  indication: string;
};

export async function createRequisition(actor: Actor, patientId: string, input: RequisitionInput) {
  requireRole(actor, "doctor");
  await assertVerified(actor);
  const [patient] = await db.select({ p: patients, wallet: users.publicKey }).from(patients).innerJoin(users, eq(users.id, patients.userId)).where(eq(patients.id, patientId));
  if (!patient) throw notFound("Patient not found.");
  if (!(await doctorCanRead(actor, patient.wallet))) throw forbidden("You do not have access to this patient's record.");
  const items = (input.items ?? []).filter((i) => i.departmentId && i.investigation?.trim());
  if (!items.length) throw badRequest("Select at least one investigation.");
  const [target] = await db.select().from(hospitals).where(eq(hospitals.id, input.targetHospitalId));
  if (!target || target.status !== "ACTIVE") throw badRequest("Choose a hospital that is active on the network.");
  const depts = await db.select().from(departments).where(eq(departments.hospitalId, target.id));
  for (const item of items) {
    const d = depts.find((x) => x.id === item.departmentId);
    if (!d || d.type !== "LABORATORY" || d.status !== "ACTIVE") throw badRequest("That laboratory department does not belong to the chosen hospital.");
    if (target.id !== actor.hospitalId && !d.acceptsOutsideRequisitions) {
      throw forbidden(`${d.name} at ${target.name} does not accept requisitions from other hospitals.`);
    }
  }

  // Algorithm 4: one parent requisition, one write-only child token per investigation.
  const parentId = newId("req");
  const created = [];
  for (const item of items) {
    const d = depts.find((x) => x.id === item.departmentId)!;
    const secret = randomBytes(32).toString("hex");
    const hash = childTokenHash(parentId, d.id, secret);
    const expiresAt = new Date(Date.now() + tokenHoursFor(d.name) * 3600_000);
    const txHash = await relay("registerToken", [hexHash(hash), idHash(d.id), BigInt(Math.floor(expiresAt.getTime() / 1000))]);
    const id = newId("lrq");
    const code = await nextCode("lab_request", "LRQ-");
    await db.insert(labRequests).values({
      id, code, parentRequisitionId: parentId, patientId, orderingPhysicianId: actor.userId, orderingHospitalId: actor.hospitalId!,
      targetHospitalId: target.id, departmentId: d.id, investigation: item.investigation.trim(), specimen: item.specimen?.trim() || null,
      clinicalIndication: input.indication?.trim() || null, tokenSecret: secret, childTokenHash: hash, expiresAt, txHash,
    });
    created.push({ id, code, department: d.name, investigation: item.investigation.trim(), tokenHash: hash, expiresAt: iso(expiresAt)!, txHash });
  }
  return { parentRequisitionId: parentId, hospital: target.name, requests: created };
}

/** The ordering physician keeps access to his or her own results even after access to the full record ends. */
export async function doctorOrders(actor: Actor) {
  requireRole(actor, "doctor");
  const rows = await db
    .select({ q: labRequests, res: labResults, patient: users.name, code: patients.code, hospital: hospitals.name, department: departments.name })
    .from(labRequests)
    .innerJoin(patients, eq(patients.id, labRequests.patientId))
    .innerJoin(users, eq(users.id, patients.userId))
    .innerJoin(hospitals, eq(hospitals.id, labRequests.targetHospitalId))
    .innerJoin(departments, eq(departments.id, labRequests.departmentId))
    .leftJoin(labResults, eq(labResults.requestId, labRequests.id))
    .where(eq(labRequests.orderingPhysicianId, actor.userId))
    .orderBy(desc(labRequests.orderedAt));
  return rows.map(({ q, res, patient, code, hospital, department }) => ({
    id: q.id, code: q.code, patientId: q.patientId, patient, patientCode: code, investigation: q.investigation, department, hospital,
    orderedAt: iso(q.orderedAt)!, expiresAt: iso(q.expiresAt)!,
    status: q.status === "FULFILLED" ? "FULFILLED" : q.expiresAt.getTime() <= Date.now() ? "EXPIRED" : "PENDING",
    uploadedAt: iso(res?.uploadedAt ?? null), txHash: res?.txHash ?? null,
    result: res ? tryDecrypt(q.orderingPhysicianId, res.resultPayload) : null,
  }));
}

function tryDecrypt(physicianId: string, payload: string) {
  try {
    return decryptFor(physicianId, payload);
  } catch {
    return "This result could not be decrypted with the current server key.";
  }
}

// ---------------------------------------------------------------- laboratory technician
function technicianDepartment(actor: Actor) {
  requireRole(actor, "lab_technician");
  if (!actor.hospitalId || !actor.working?.departmentId) throw forbidden("You are not assigned to a laboratory department.");
  return { hospitalId: actor.hospitalId, departmentId: actor.working.departmentId };
}

/** What a technician may see of a requisition: the test, the specimen, the indication. Nothing else of the patient. */
function technicianView(q: typeof labRequests.$inferSelect, patientName: string, patientCode: string, doctor: string, fromHospital: string) {
  const parts = patientName.trim().split(/\s+/);
  const short = parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : patientName;
  return {
    id: q.id, code: q.code, investigation: q.investigation, specimen: q.specimen, clinicalIndication: q.clinicalIndication,
    patient: short, patientCode, orderedBy: doctor, orderedFrom: fromHospital, orderedAt: iso(q.orderedAt)!, expiresAt: iso(q.expiresAt)!,
    expired: q.expiresAt.getTime() <= Date.now(), status: q.status,
  };
}

async function departmentRequests(departmentId: string) {
  return db
    .select({ q: labRequests, patient: users.name, code: patients.code })
    .from(labRequests)
    .innerJoin(patients, eq(patients.id, labRequests.patientId))
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(labRequests.departmentId, departmentId))
    .orderBy(asc(labRequests.expiresAt));
}

/** Names of the ordering doctors and hospitals, for the technician's view. */
async function names() {
  const [us, hs] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ id: hospitals.id, name: hospitals.name }).from(hospitals),
  ]);
  const u = new Map(us.map((x) => [x.id, x.name]));
  const h = new Map(hs.map((x) => [x.id, x.name]));
  return { doctor: (id: string) => u.get(id) ?? "", hospital: (id: string) => h.get(id) ?? "" };
}

export async function labQueue(actor: Actor) {
  const { departmentId } = technicianDepartment(actor);
  const [rows, n] = await Promise.all([departmentRequests(departmentId), names()]);
  return {
    department: actor.working!.departmentName, hospital: actor.working!.hospitalName, verified: actor.working!.status === "ACTIVE",
    // Only this department's open requisitions. Other departments' requisitions are never loaded.
    requests: rows.filter((r) => r.q.status === "PENDING").map((r) => technicianView(r.q, r.patient, r.code, n.doctor(r.q.orderingPhysicianId), n.hospital(r.q.orderingHospitalId))),
  };
}

export async function labRequestForUpload(actor: Actor, requestId: string) {
  const { departmentId } = technicianDepartment(actor);
  const [[row], n] = await Promise.all([
    db
      .select({ q: labRequests, patient: users.name, code: patients.code })
      .from(labRequests)
      .innerJoin(patients, eq(patients.id, labRequests.patientId))
      .innerJoin(users, eq(users.id, patients.userId))
      .where(eq(labRequests.id, requestId)),
    names(),
  ]);
  if (!row) throw notFound("Requisition not found.");
  if (row.q.departmentId !== departmentId) throw forbidden("This requisition is addressed to another department.");
  return {
    ...technicianView(row.q, row.patient, row.code, n.doctor(row.q.orderingPhysicianId), n.hospital(row.q.orderingHospitalId)),
    // The token secret is handed to the receiving department only, and only while the requisition is open.
    token: row.q.status === "PENDING" ? row.q.tokenSecret : null,
    tokenHash: row.q.childTokenHash,
  };
}

export type ResultInput = { token: string; result: string; comment?: string };

export async function uploadResult(actor: Actor, requestId: string, input: ResultInput) {
  const { departmentId } = technicianDepartment(actor);
  await assertVerified(actor); // a suspended technician cannot upload
  const [q] = await db.select().from(labRequests).where(eq(labRequests.id, requestId));
  if (!q) throw notFound("Requisition not found.");
  if (q.departmentId !== departmentId) throw forbidden("Rejected: this requisition is addressed to another department.");
  if (q.status !== "PENDING") throw badRequest("Rejected: the token for this requisition has already been used.");
  // Algorithm 4, steps 9 and 10.
  if (childTokenHash(q.parentRequisitionId, q.departmentId, input.token ?? "") !== q.childTokenHash) throw forbidden("Rejected: the token does not match this requisition.");
  if (q.expiresAt.getTime() <= Date.now()) throw badRequest("Rejected: the token has expired. Ask the doctor for a new order.");
  if (!(await isTokenValidOnChain(q.childTokenHash))) throw badRequest("Rejected: the ledger reports this token as expired or already used.");
  const text = (input.result ?? "").trim();
  if (!text) throw badRequest("Enter the result.");

  const plaintext = JSON.stringify({ result: text, comment: (input.comment ?? "").trim(), investigation: q.investigation });
  const payload = encryptFor(q.orderingPhysicianId, plaintext); // step 11
  const resultHash = sha256(plaintext);
  const txHash = await relay("anchorResult", [hexHash(q.childTokenHash), hexHash(resultHash)]); // step 13: also invalidates the token on the ledger
  const id = newId("lrs");
  await db.insert(labResults).values({ id, requestId: q.id, technicianId: actor.userId, resultPayload: payload, resultHash, txHash });
  await db.update(labRequests).set({ status: "FULFILLED" }).where(eq(labRequests.id, q.id)); // step 14
  return { resultId: id, code: q.code, txHash, resultHash };
}

export async function labHistory(actor: Actor) {
  technicianDepartment(actor);
  const rows = await db
    .select({ res: labResults, q: labRequests, patient: users.name, code: patients.code })
    .from(labResults)
    .innerJoin(labRequests, eq(labRequests.id, labResults.requestId))
    .innerJoin(patients, eq(patients.id, labRequests.patientId))
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(labResults.technicianId, actor.userId))
    .orderBy(desc(labResults.uploadedAt));
  // The technician sees that an upload was accepted, not the stored result or anything else about the patient.
  return rows.map(({ res, q, code }) => ({ code: q.code, investigation: q.investigation, patientCode: code, uploadedAt: iso(res.uploadedAt)!, txHash: res.txHash, resultHash: res.resultHash }));
}
