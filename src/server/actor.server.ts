import { and, eq } from "drizzle-orm";
import { db } from "~/db/index.server";
import { departments, hospitals, patients, staffAffiliations, users } from "~/db/schema";
import { isVerifiedOnChain } from "./chain.server";
import { AppError, forbidden } from "./util.server";

export type Role = "patient" | "doctor" | "nurse" | "lab_technician" | "hospital_admin" | "registrar";

export type Affiliation = {
  id: string;
  hospitalId: string;
  hospitalName: string;
  hospitalStatus: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentType: string | null;
  position: string | null;
  status: string;
};

/** Who is making the request, and at which hospital he or she is working. */
export type Actor = {
  userId: string;
  role: Role;
  name: string;
  email: string;
  wallet: string | null;
  licenseNo: string | null;
  patientId: string | null;
  affiliations: Affiliation[];
  /** the working hospital (FR12); null for patients and the registrar */
  hospitalId: string | null;
  working: Affiliation | null;
};

export async function loadActor(userId: string, preferredHospitalId?: string | null): Promise<Actor> {
  // The three lookups do not depend on each other, so they are sent together: one network round trip, not three.
  // This runs at the start of every server call, so it sets the floor for how fast any screen can load.
  const [[u], affs, [p]] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    affiliationsOf(userId),
    db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)),
  ]);
  if (!u) throw new AppError(401, "Please sign in.");
  affs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const affiliations: Affiliation[] = affs.map(({ createdAt: _c, ...a }) => a);
  const working = affiliations.find((a) => a.hospitalId === preferredHospitalId) ?? affiliations[0] ?? null;
  return {
    userId: u.id,
    role: u.role as Role,
    name: u.name,
    email: u.email,
    wallet: u.publicKey,
    licenseNo: u.medicalLicenseNo,
    patientId: u.role === "patient" ? (p?.id ?? null) : null,
    affiliations,
    hospitalId: working?.hospitalId ?? null,
    working,
  };
}

function affiliationsOf(userId: string) {
  return db
    .select({
      id: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      hospitalStatus: hospitals.status,
      departmentId: staffAffiliations.departmentId,
      departmentName: departments.name,
      departmentType: departments.type,
      position: staffAffiliations.position,
      status: staffAffiliations.status,
      createdAt: staffAffiliations.createdAt,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .leftJoin(departments, eq(departments.id, staffAffiliations.departmentId))
    .where(eq(staffAffiliations.userId, userId));
}

export function requireRole(actor: Actor, ...roles: Role[]) {
  if (!roles.includes(actor.role)) throw forbidden("Your role does not allow this action.");
}

/**
 * A practitioner may write to a record only while verified at the working hospital:
 * the affiliation must be active in the database AND on the smart contract.
 */
export async function assertVerified(actor: Actor) {
  if (!actor.working || !actor.hospitalId) throw forbidden("You are not affiliated with a hospital.");
  if (actor.working.hospitalStatus !== "ACTIVE") throw forbidden("This hospital is suspended on the network.");
  if (actor.working.status !== "ACTIVE") throw forbidden("Your account has not been verified by your hospital's administrator, or it is suspended.");
  if (!actor.wallet) throw forbidden("Connect and bind your wallet first.");
  if (!(await isVerifiedOnChain(actor.wallet, actor.hospitalId))) {
    throw forbidden("The ledger does not show you as a verified practitioner of this hospital.");
  }
}

export async function affiliationOf(userId: string, hospitalId: string) {
  const [a] = await db
    .select()
    .from(staffAffiliations)
    .where(and(eq(staffAffiliations.userId, userId), eq(staffAffiliations.hospitalId, hospitalId)));
  return a ?? null;
}
