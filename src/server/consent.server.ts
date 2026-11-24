// FR1 consent, FR2 Glass-Break, and the patient's audit log.
import { and, desc, eq, ilike, inArray, lte, or } from "drizzle-orm";
import { db } from "~/db/index.server";
import { accessGrants, clinicalRecords, disputes, hospitals, patients, users } from "~/db/schema";
import { type Actor, assertVerified, requireRole } from "./actor.server";
import { eventExists, expectEvent, hasAccessOnChain, idHash } from "./chain.server";
import { badRequest, forbidden, lower, newId, notFound } from "./util.server";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function patientWithWallet(patientId: string) {
  const [row] = await db
    .select({ p: patients, name: users.name, wallet: users.publicKey })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(patients.id, patientId));
  if (!row) throw notFound("Patient not found.");
  return row;
}

/**
 * Marks grants whose time has run out, in one statement. It is sent together with the query that reads the
 * grants, so it costs no extra wait; current() below makes sure that read shows the right status either way.
 */
function sweepExpired(where: ReturnType<typeof eq>) {
  return db
    .update(accessGrants)
    .set({ status: "EXPIRED" })
    .where(and(where, eq(accessGrants.status, "GRANTED"), lte(accessGrants.expiresAt, new Date())));
}

/** A grant past its expiry is expired, whatever its row said when it was read. */
const current = <T extends { status: string; expiresAt: Date | null }>(g: T): T =>
  g.status === "GRANTED" && g.expiresAt && g.expiresAt.getTime() <= Date.now() ? { ...g, status: "EXPIRED" } : g;

/** The authority for reading a record is the smart contract, not the database. */
export async function doctorCanRead(actor: Actor, patientWallet: string | null): Promise<boolean> {
  if (actor.role !== "doctor" || !actor.wallet || !patientWallet) return false;
  return hasAccessOnChain(patientWallet, actor.wallet);
}

// ---------------------------------------------------------------- doctor
export async function searchPatients(actor: Actor, query: string) {
  requireRole(actor, "doctor");
  const q = (query ?? "").trim();
  const base = db
    .select({ id: patients.id, code: patients.code, name: users.name, sex: patients.sex, dateOfBirth: patients.dateOfBirth, wallet: users.publicKey })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId));
  const [rows] = await Promise.all([
    (q ? base.where(or(ilike(users.name, `%${q}%`), ilike(patients.code, `%${q}%`))) : base).orderBy(patients.code).limit(25),
    sweepExpired(eq(accessGrants.practitionerId, actor.userId)),
  ]);
  const mine = rows.length
    ? (await db.select().from(accessGrants).where(and(eq(accessGrants.practitionerId, actor.userId), inArray(accessGrants.patientId, rows.map((r) => r.id))))).map(current)
    : [];
  const out = [];
  for (const r of rows) {
    const grants = mine.filter((g) => g.patientId === r.id);
    const active = grants.find((g) => g.status === "GRANTED");
    const pending = grants.find((g) => g.status === "PENDING");
    // Clinical history stays hidden: only identity and the state of this doctor's access are returned.
    out.push({
      id: r.id, code: r.code, name: r.name, sex: r.sex, dateOfBirth: r.dateOfBirth, hasWallet: Boolean(r.wallet), wallet: r.wallet,
      access: active ? (active.grantType === "EMERGENCY" ? "EMERGENCY" : "GRANTED") : pending ? "PENDING" : "NONE",
      expiresAt: iso(active?.expiresAt ?? null),
    });
  }
  return out;
}

export async function requestAccess(actor: Actor, patientId: string) {
  requireRole(actor, "doctor");
  await assertVerified(actor);
  await patientWithWallet(patientId);
  const [open] = await db
    .select()
    .from(accessGrants)
    .where(and(eq(accessGrants.patientId, patientId), eq(accessGrants.practitionerId, actor.userId), eq(accessGrants.status, "PENDING")));
  if (open) return { id: open.id, status: "PENDING" };
  const id = newId("acc");
  await db.insert(accessGrants).values({ id, patientId, practitionerId: actor.userId, hospitalId: actor.hospitalId!, grantType: "CONSENT", status: "PENDING" });
  return { id, status: "PENDING" };
}

/** Called after the doctor has signed emergencyAccess in MetaMask. */
export async function confirmEmergencyAccess(actor: Actor, patientId: string, txHash: string) {
  requireRole(actor, "doctor");
  if (!actor.hospitalId || !actor.wallet) throw forbidden("You are not affiliated with a hospital.");
  const { wallet } = await patientWithWallet(patientId);
  const ev = await expectEvent(txHash, "EmergencyAccessLogged", actor.wallet);
  if (lower(String(ev.args.patient)) !== wallet || String(ev.args.hospitalId).toLowerCase() !== idHash(actor.hospitalId).toLowerCase()) {
    throw badRequest("That override was logged for a different patient or hospital.");
  }
  const [dup] = await db.select().from(accessGrants).where(eq(accessGrants.txHash, txHash));
  if (dup) return { id: dup.id, expiresAt: iso(dup.expiresAt) };
  const id = newId("acc");
  const expiresAt = new Date(ev.blockTime.getTime() + 60 * 60 * 1000);
  await db.insert(accessGrants).values({
    id, patientId, practitionerId: actor.userId, hospitalId: actor.hospitalId, grantType: "EMERGENCY", status: "GRANTED",
    requestedAt: ev.blockTime, decidedAt: ev.blockTime, expiresAt, txHash,
  });
  return { id, expiresAt: iso(expiresAt) };
}

// ---------------------------------------------------------------- patient
function requirePatient(actor: Actor): string {
  requireRole(actor, "patient");
  if (!actor.patientId) throw forbidden("Complete your patient registration first.");
  return actor.patientId;
}

export async function listAccess(actor: Actor) {
  const patientId = requirePatient(actor);
  const [read] = await Promise.all([
    db
      .select({ g: accessGrants, practitioner: users.name, licenseNo: users.medicalLicenseNo, wallet: users.publicKey, hospital: hospitals.name, city: hospitals.city })
      .from(accessGrants)
      .innerJoin(users, eq(users.id, accessGrants.practitionerId))
      .innerJoin(hospitals, eq(hospitals.id, accessGrants.hospitalId))
      .where(eq(accessGrants.patientId, patientId))
      .orderBy(desc(accessGrants.requestedAt)),
    sweepExpired(eq(accessGrants.patientId, patientId)),
  ]);
  const rows = read.map((r) => ({ ...r, g: current(r.g) }));
  const shape = (r: (typeof rows)[number]) => ({
    id: r.g.id, practitioner: r.practitioner, practitionerWallet: r.wallet, licenseNo: r.licenseNo, hospital: r.hospital, city: r.city,
    grantType: r.g.grantType, status: r.g.status, requestedAt: iso(r.g.requestedAt), decidedAt: iso(r.g.decidedAt), expiresAt: iso(r.g.expiresAt), txHash: r.g.txHash,
  });
  return {
    pending: rows.filter((r) => r.g.status === "PENDING").map(shape),
    active: rows.filter((r) => r.g.status === "GRANTED").map(shape),
    past: rows.filter((r) => !["PENDING", "GRANTED"].includes(r.g.status)).map(shape),
  };
}

async function ownGrant(actor: Actor, grantId: string) {
  const patientId = requirePatient(actor);
  const [row] = await db
    .select({ g: accessGrants, wallet: users.publicKey })
    .from(accessGrants)
    .innerJoin(users, eq(users.id, accessGrants.practitionerId))
    .where(eq(accessGrants.id, grantId));
  if (!row || row.g.patientId !== patientId) throw notFound("Request not found.");
  return row;
}

/** Called after the patient has signed grantAccess in MetaMask. */
export async function confirmGrant(actor: Actor, grantId: string, txHash: string) {
  const { g, wallet } = await ownGrant(actor, grantId);
  if (g.status !== "PENDING") throw badRequest("This request has already been answered.");
  const ev = await expectEvent(txHash, "AccessGranted", actor.wallet);
  if (lower(String(ev.args.patient)) !== actor.wallet || lower(String(ev.args.practitioner)) !== wallet) {
    throw badRequest("That transaction granted access to a different practitioner.");
  }
  const expiresAt = new Date(Number(ev.args.expiresAt) * 1000);
  await db.update(accessGrants).set({ status: "GRANTED", decidedAt: ev.blockTime, expiresAt, txHash }).where(eq(accessGrants.id, g.id));
  return { status: "GRANTED", expiresAt: iso(expiresAt), txHash };
}

/** Declining needs no transaction: nothing was granted, so there is nothing to record on the ledger. */
export async function declineRequest(actor: Actor, grantId: string) {
  const { g } = await ownGrant(actor, grantId);
  if (g.status !== "PENDING") throw badRequest("This request has already been answered.");
  await db.update(accessGrants).set({ status: "DECLINED", decidedAt: new Date() }).where(eq(accessGrants.id, g.id));
  return { status: "DECLINED" };
}

/** Called after the patient has signed revokeAccess in MetaMask. */
export async function confirmRevoke(actor: Actor, grantId: string, txHash: string) {
  const { g, wallet } = await ownGrant(actor, grantId);
  if (g.status !== "GRANTED") throw badRequest("This access is not active.");
  const ev = await expectEvent(txHash, "AccessRevoked", actor.wallet);
  if (lower(String(ev.args.patient)) !== actor.wallet || lower(String(ev.args.practitioner)) !== wallet) {
    throw badRequest("That transaction revoked a different practitioner.");
  }
  // One revocation on the contract ends every grant this practitioner holds on this patient.
  await db
    .update(accessGrants)
    .set({ status: "REVOKED", expiresAt: ev.blockTime, revokeTxHash: txHash })
    .where(and(eq(accessGrants.patientId, g.patientId), eq(accessGrants.practitionerId, g.practitionerId), eq(accessGrants.status, "GRANTED")));
  return { status: "REVOKED", txHash };
}

/**
 * The patient's audit log. Every entry carries the hash of the transaction that produced it, and the entry is
 * marked "verified" only if that transaction, read back from the chain, really contains the event.
 */
export async function auditLog(actor: Actor) {
  const patientId = requirePatient(actor);
  const [grantRows, disp] = await Promise.all([
    db
      .select({ g: accessGrants, practitioner: users.name, licenseNo: users.medicalLicenseNo, hospital: hospitals.name })
      .from(accessGrants)
      .innerJoin(users, eq(users.id, accessGrants.practitionerId))
      .innerJoin(hospitals, eq(hospitals.id, accessGrants.hospitalId))
      .where(eq(accessGrants.patientId, patientId)),
    db
      .select({ d: disputes, practitioner: users.name, licenseNo: users.medicalLicenseNo, hospital: hospitals.name })
      .from(disputes)
      .innerJoin(clinicalRecords, eq(clinicalRecords.id, disputes.newAddendumId))
      .innerJoin(users, eq(users.id, disputes.practitionerId))
      .innerJoin(hospitals, eq(hospitals.id, clinicalRecords.hospitalId))
      .where(eq(clinicalRecords.patientId, patientId)),
    sweepExpired(eq(accessGrants.patientId, patientId)),
  ]);
  const grants = grantRows.map((r) => ({ ...r, g: current(r.g) }));

  type Entry = { at: string; kind: "GRANT" | "REVOKE" | "OVERRIDE" | "DISPUTE"; practitioner: string; licenseNo: string | null; hospital: string; txHash: string | null; event: Parameters<typeof eventExists>[1] };
  const entries: Entry[] = [];
  for (const r of grants) {
    const who = { practitioner: r.practitioner, licenseNo: r.licenseNo, hospital: r.hospital };
    if (r.g.grantType === "EMERGENCY") {
      entries.push({ at: iso(r.g.decidedAt ?? r.g.requestedAt)!, kind: "OVERRIDE", ...who, txHash: r.g.txHash, event: "EmergencyAccessLogged" });
      continue;
    }
    if (["GRANTED", "REVOKED", "EXPIRED"].includes(r.g.status) && r.g.decidedAt) {
      entries.push({ at: iso(r.g.decidedAt)!, kind: "GRANT", ...who, txHash: r.g.txHash, event: "AccessGranted" });
    }
    if (r.g.status === "REVOKED" && r.g.expiresAt) {
      entries.push({ at: iso(r.g.expiresAt)!, kind: "REVOKE", ...who, txHash: r.g.revokeTxHash, event: "AccessRevoked" });
    }
  }
  for (const r of disp) {
    entries.push({ at: iso(r.d.createdAt)!, kind: "DISPUTE", practitioner: r.practitioner, licenseNo: r.licenseNo, hospital: r.hospital, txHash: r.d.txHash, event: "AddendumAnchored" });
  }
  const verified = await Promise.all(entries.map((e) => eventExists(e.txHash, e.event)));
  return entries
    .map(({ event: _e, ...e }, i) => ({ ...e, verifiedOnChain: verified[i] }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
