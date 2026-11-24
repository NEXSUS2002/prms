// Network registry: hospital applications (registrar), staff and departments (hospital administrator).
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "~/db/index.server";
import { accounts, departments, hospitalApplications, hospitals, staffAffiliations, users } from "~/db/schema";
import { type Actor, requireRole } from "./actor.server";
import { expectEvent, idHash } from "./chain.server";
import { AppError, badRequest, forbidden, isAddress, lower, newId, nextCode, notFound } from "./util.server";

const LEVELS = ["primary", "secondary", "tertiary"];
const DEPT_TYPES = ["LABORATORY", "CLINICAL", "WARD"];
const STAFF_ROLES = ["doctor", "nurse", "lab_technician"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function createUserWithPassword(input: {
  id?: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  licenseNo?: string | null;
  wallet?: string | null;
}) {
  const id = input.id ?? newId("usr");
  await db.insert(users).values({
    id,
    name: input.name,
    email: input.email.toLowerCase(),
    emailVerified: true,
    role: input.role,
    medicalLicenseNo: input.licenseNo ?? null,
    publicKey: input.wallet ? lower(input.wallet) : null,
  });
  await db.insert(accounts).values({ id: newId("acc"), accountId: id, providerId: "credential", userId: id, password: input.passwordHash });
  return id;
}

// ---------------------------------------------------------------- hospital application (public form)
export type ApplicationInput = {
  name: string;
  city: string;
  state: string;
  level: string;
  facilityRegistrationNo: string;
  departments: string[];
  adminName: string;
  adminEmail: string;
  adminWallet: string;
  adminPassword: string;
};

export async function submitApplication(input: ApplicationInput) {
  const name = input.name?.trim();
  if (!name || !input.city?.trim() || !input.state?.trim()) throw badRequest("Enter the hospital's name, city and state.");
  if (!LEVELS.includes(input.level)) throw badRequest("Choose a level of care.");
  if (!input.facilityRegistrationNo?.trim()) throw badRequest("Enter the facility registration number issued by the State Ministry of Health.");
  if (!input.adminName?.trim() || !EMAIL.test(input.adminEmail ?? "")) throw badRequest("Enter the administrator's name and a valid email address.");
  if (!isAddress(input.adminWallet)) throw badRequest("The administrator's wallet address is not a valid address.");
  if ((input.adminPassword ?? "").length < 8) throw badRequest("The administrator's password must have at least 8 characters.");
  const email = input.adminEmail.toLowerCase();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw badRequest("That email address already has an account.");
  const depts = [...new Set((input.departments ?? []).map((d) => d.trim()).filter(Boolean))];
  const id = newId("app");
  const reference = await nextCode("application", "HSP-APP-");
  await db.insert(hospitalApplications).values({
    id,
    reference,
    name,
    city: input.city.trim(),
    state: input.state.trim(),
    level: input.level,
    facilityRegistrationNo: input.facilityRegistrationNo.trim(),
    departments: depts,
    adminName: input.adminName.trim(),
    adminEmail: email,
    adminWallet: lower(input.adminWallet),
    adminPasswordHash: await hashPassword(input.adminPassword),
  });
  return { id, reference, name, adminName: input.adminName.trim() };
}

// ---------------------------------------------------------------- registrar
export async function registryOverview(actor: Actor) {
  requireRole(actor, "registrar");
  const [hs, apps] = await Promise.all([
    db.select().from(hospitals).orderBy(asc(hospitals.code)),
    db.select().from(hospitalApplications).orderBy(desc(hospitalApplications.submittedAt)),
  ]);
  const boundWallets = new Map(hs.filter((h) => h.adminWallet).map((h) => [h.adminWallet as string, h.code]));
  return {
    // Staff are deliberately absent: the registrar sees hospitals, never their people or any patient.
    hospitals: hs.map((h) => ({
      id: h.id, code: h.code, name: h.name, city: h.city, state: h.state, level: h.level,
      adminWallet: h.adminWallet, status: h.status, registeredTx: h.registeredTx, idHash: idHash(h.id),
    })),
    applications: apps.map((a) => ({
      id: a.id, reference: a.reference, name: a.name, city: a.city, state: a.state, level: a.level,
      facilityRegistrationNo: a.facilityRegistrationNo, departments: a.departments,
      adminName: a.adminName, adminEmail: a.adminEmail, adminWallet: a.adminWallet,
      status: a.status, decisionNote: a.decisionNote, submittedAt: iso(a.submittedAt), decidedAt: iso(a.decidedAt),
      walletBoundTo: boundWallets.get(a.adminWallet) ?? null,
      // what the registrar must send to the contract to approve this application
      plannedHospitalId: plannedHospitalId(a.id), plannedIdHash: idHash(plannedHospitalId(a.id)),
    })),
  };
}

const plannedHospitalId = (applicationId: string) => "hosp_" + applicationId.replace(/^app_/, "");

/** Called after the registrar has signed registerHospital in MetaMask. */
export async function confirmHospitalApproval(actor: Actor, applicationId: string, txHash: string) {
  requireRole(actor, "registrar");
  const [app] = await db.select().from(hospitalApplications).where(eq(hospitalApplications.id, applicationId));
  if (!app) throw notFound("Application not found.");
  if (app.status !== "AWAITING_REVIEW") throw badRequest("This application has already been decided.");
  const hospitalId = plannedHospitalId(app.id);
  const ev = await expectEvent(txHash, "HospitalRegistered", actor.wallet);
  if (String(ev.args.hospitalId).toLowerCase() !== idHash(hospitalId).toLowerCase() || lower(String(ev.args.admin)) !== app.adminWallet) {
    throw badRequest("That transaction registered a different hospital or administrator wallet.");
  }
  const code = "HSP-" + app.reference.replace(/^HSP-APP-/, "");
  const adminId = await createUserWithPassword({ name: app.adminName, email: app.adminEmail, passwordHash: app.adminPasswordHash, role: "hospital_admin", wallet: app.adminWallet });
  await db.insert(hospitals).values({
    id: hospitalId, code, name: app.name, city: app.city, state: app.state, level: app.level,
    facilityRegistrationNo: app.facilityRegistrationNo, adminUserId: adminId, adminWallet: app.adminWallet, registeredTx: txHash,
  });
  for (const d of app.departments) {
    await db.insert(departments).values({ id: newId("dep"), hospitalId, name: d, type: "LABORATORY", acceptsOutsideRequisitions: false });
  }
  await db.insert(staffAffiliations).values({ id: newId("aff"), userId: adminId, hospitalId, status: "ACTIVE", verifiedTx: txHash, position: "Hospital administrator" });
  await db.update(hospitalApplications).set({ status: "APPROVED", hospitalId, decidedAt: new Date() }).where(eq(hospitalApplications.id, app.id));
  return { hospitalId, code, txHash };
}

export async function rejectApplication(actor: Actor, applicationId: string, note: string) {
  requireRole(actor, "registrar");
  const [app] = await db.select().from(hospitalApplications).where(eq(hospitalApplications.id, applicationId));
  if (!app) throw notFound("Application not found.");
  if (app.status !== "AWAITING_REVIEW") throw badRequest("This application has already been decided.");
  await db.update(hospitalApplications).set({ status: "REJECTED", decisionNote: note?.trim() || null, decidedAt: new Date() }).where(eq(hospitalApplications.id, app.id));
  return { ok: true };
}

/** Called after the registrar has signed setHospitalActive in MetaMask. */
export async function confirmHospitalStatus(actor: Actor, hospitalId: string, txHash: string) {
  requireRole(actor, "registrar");
  const [h] = await db.select().from(hospitals).where(eq(hospitals.id, hospitalId));
  if (!h) throw notFound("Hospital not found.");
  const ev = await expectEvent(txHash, "HospitalStatusChanged", actor.wallet);
  if (String(ev.args.hospitalId).toLowerCase() !== idHash(hospitalId).toLowerCase()) throw badRequest("That transaction concerns a different hospital.");
  const status = ev.args.active ? "ACTIVE" : "SUSPENDED";
  await db.update(hospitals).set({ status }).where(eq(hospitals.id, hospitalId));
  return { status };
}

// ---------------------------------------------------------------- hospital administrator: staff
function adminHospital(actor: Actor): string {
  requireRole(actor, "hospital_admin");
  if (!actor.hospitalId) throw forbidden("Your account is not attached to a hospital.");
  return actor.hospitalId;
}

export async function listStaff(actor: Actor) {
  const hospitalId = adminHospital(actor);
  const rows = await db
    .select({
      affiliationId: staffAffiliations.id, userId: users.id, name: users.name, email: users.email, role: users.role,
      licenseNo: users.medicalLicenseNo, wallet: users.publicKey, status: staffAffiliations.status,
      position: staffAffiliations.position, verifiedTx: staffAffiliations.verifiedTx, departmentName: departments.name,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .leftJoin(departments, eq(departments.id, staffAffiliations.departmentId))
    .where(and(eq(staffAffiliations.hospitalId, hospitalId), ne(users.role, "hospital_admin")))
    .orderBy(asc(users.name));
  // "Also at ..." for practitioners who work at more than one hospital. Only the names of the other hospitals are read.
  const ids = rows.map((r) => r.userId);
  const [others, [h]] = await Promise.all([
    ids.length
      ? db
          .select({ userId: staffAffiliations.userId, hospitalName: hospitals.name })
          .from(staffAffiliations)
          .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
          .where(and(inArray(staffAffiliations.userId, ids), ne(staffAffiliations.hospitalId, hospitalId)))
      : Promise.resolve([]),
    db.select().from(hospitals).where(eq(hospitals.id, hospitalId)),
  ]);
  return {
    hospital: { id: h.id, name: h.name, code: h.code, status: h.status },
    staff: rows.map((r) => ({ ...r, alsoAt: others.filter((o) => o.userId === r.userId).map((o) => o.hospitalName) })),
  };
}

export type StaffInput = {
  name: string;
  email: string;
  password: string;
  role: string;
  departmentId: string;
  licenseNo: string;
  wallet: string;
  position?: string;
};

/** Creates the account (or links an existing practitioner) with an affiliation that is not yet verified. */
export async function addStaff(actor: Actor, input: StaffInput) {
  const hospitalId = adminHospital(actor);
  if (!STAFF_ROLES.includes(input.role)) throw badRequest("Choose a role: doctor, nurse or laboratory technician.");
  if (!input.name?.trim() || !EMAIL.test(input.email ?? "")) throw badRequest("Enter the practitioner's name and a valid email address.");
  if (!input.licenseNo?.trim()) throw badRequest("Enter the licence number.");
  if (!isAddress(input.wallet)) throw badRequest("The wallet address is not a valid address.");
  const [dept] = await db.select().from(departments).where(and(eq(departments.id, input.departmentId), eq(departments.hospitalId, hospitalId)));
  if (!dept) throw badRequest("Choose one of your hospital's departments.");
  const wantType = input.role === "lab_technician" ? "LABORATORY" : input.role === "nurse" ? "WARD" : "CLINICAL";
  if (dept.type !== wantType) throw badRequest(`A ${input.role.replace("_", " ")} must be assigned to a ${wantType.toLowerCase()} department.`);

  const email = input.email.toLowerCase();
  const wallet = lower(input.wallet);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  let userId: string;
  if (existing) {
    // A practitioner who already works at another hospital: add a second affiliation (FR12).
    if (existing.role !== input.role) throw badRequest("That email belongs to an account with a different role.");
    if (existing.publicKey && existing.publicKey !== wallet) throw badRequest("That practitioner is already bound to a different wallet.");
    const [dup] = await db.select().from(staffAffiliations).where(and(eq(staffAffiliations.userId, existing.id), eq(staffAffiliations.hospitalId, hospitalId)));
    if (dup) throw badRequest("That practitioner is already on your staff register.");
    userId = existing.id;
  } else {
    if ((input.password ?? "").length < 8) throw badRequest("Set an initial password of at least 8 characters.");
    const [walletTaken] = await db.select({ id: users.id }).from(users).where(eq(users.publicKey, wallet));
    if (walletTaken) throw badRequest("That wallet address is already bound to another account.");
    userId = await createUserWithPassword({ name: input.name.trim(), email, passwordHash: await hashPassword(input.password), role: input.role, licenseNo: input.licenseNo.trim(), wallet });
  }
  const affiliationId = newId("aff");
  await db.insert(staffAffiliations).values({ id: affiliationId, userId, hospitalId, departmentId: dept.id, position: input.position?.trim() || null });
  return { affiliationId, userId, wallet, licenseNo: existing?.medicalLicenseNo ?? input.licenseNo.trim() };
}

async function ownAffiliation(actor: Actor, affiliationId: string) {
  const hospitalId = adminHospital(actor);
  const [row] = await db
    .select({ aff: staffAffiliations, user: users })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(eq(staffAffiliations.id, affiliationId));
  if (!row) throw notFound("Staff member not found.");
  // FR10: an administrator acts on his or her own hospital only.
  if (row.aff.hospitalId !== hospitalId) throw forbidden("That practitioner belongs to another hospital.");
  return { ...row, hospitalId };
}

/** Called after the administrator has signed verifyPractitioner in MetaMask. Also used to lift a suspension. */
export async function confirmStaffVerification(actor: Actor, affiliationId: string, txHash: string) {
  const { aff, user, hospitalId } = await ownAffiliation(actor, affiliationId);
  const ev = await expectEvent(txHash, "PractitionerVerified", actor.wallet);
  if (lower(String(ev.args.practitioner)) !== user.publicKey || String(ev.args.hospitalId).toLowerCase() !== idHash(hospitalId).toLowerCase()) {
    throw badRequest("That transaction verified a different practitioner or hospital.");
  }
  await db.update(staffAffiliations).set({ status: "ACTIVE", verifiedTx: txHash }).where(eq(staffAffiliations.id, aff.id));
  return { status: "ACTIVE", txHash };
}

/** Called after the administrator has signed suspendPractitioner in MetaMask. */
export async function confirmStaffSuspension(actor: Actor, affiliationId: string, txHash: string) {
  const { aff, user, hospitalId } = await ownAffiliation(actor, affiliationId);
  const ev = await expectEvent(txHash, "PractitionerSuspended", actor.wallet);
  if (lower(String(ev.args.practitioner)) !== user.publicKey || String(ev.args.hospitalId).toLowerCase() !== idHash(hospitalId).toLowerCase()) {
    throw badRequest("That transaction suspended a different practitioner.");
  }
  await db.update(staffAffiliations).set({ status: "SUSPENDED" }).where(eq(staffAffiliations.id, aff.id));
  return { status: "SUSPENDED", txHash };
}

/** Details the client needs to build the verify / suspend transaction. */
export async function staffTxTarget(actor: Actor, affiliationId: string) {
  const { aff, user } = await ownAffiliation(actor, affiliationId);
  if (!user.publicKey) throw badRequest("This practitioner has no wallet address on file.");
  if (!user.medicalLicenseNo) throw badRequest("This practitioner has no licence number on file.");
  return { affiliationId: aff.id, wallet: user.publicKey, licenseNo: user.medicalLicenseNo, name: user.name, status: aff.status };
}

// ---------------------------------------------------------------- hospital administrator: profile and departments (FR13)
export async function hospitalProfile(actor: Actor) {
  const hospitalId = adminHospital(actor);
  const [h] = await db.select().from(hospitals).where(eq(hospitals.id, hospitalId));
  const depts = await db.select().from(departments).where(eq(departments.hospitalId, hospitalId));
  const affs = await db
    .select({ departmentId: staffAffiliations.departmentId })
    .from(staffAffiliations)
    .where(eq(staffAffiliations.hospitalId, hospitalId));
  const order: Record<string, number> = { LABORATORY: 0, CLINICAL: 1, WARD: 2 };
  return {
    // The profile does not list the other hospitals on the network: that list belongs to the registrar.
    hospital: {
      id: h.id, code: h.code, name: h.name, city: h.city, state: h.state, level: h.level,
      facilityRegistrationNo: h.facilityRegistrationNo, adminWallet: h.adminWallet, registeredTx: h.registeredTx,
      status: h.status, joinedAt: iso(h.createdAt),
    },
    departments: depts
      .sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name))
      .map((d) => ({
        id: d.id, name: d.name, type: d.type, acceptsOutsideRequisitions: d.acceptsOutsideRequisitions,
        staffCount: affs.filter((a) => a.departmentId === d.id).length,
      })),
  };
}

export async function addDepartment(actor: Actor, input: { name: string; type: string; acceptsOutsideRequisitions?: boolean }) {
  const hospitalId = adminHospital(actor);
  const name = input.name?.trim().replace(/\s+/g, " ");
  if (!name) throw badRequest("Enter the department's name.");
  if (!DEPT_TYPES.includes(input.type)) throw badRequest("Choose a type: laboratory, clinical or ward.");
  const existing = await db.select().from(departments).where(eq(departments.hospitalId, hospitalId));
  if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw badRequest("Your hospital already has a department with that name.");
  const id = newId("dep");
  await db.insert(departments).values({
    id, hospitalId, name, type: input.type,
    acceptsOutsideRequisitions: input.type === "LABORATORY" ? Boolean(input.acceptsOutsideRequisitions) : null,
  });
  return { id, name, type: input.type };
}

export async function setDepartmentSharing(actor: Actor, departmentId: string, accepts: boolean) {
  const hospitalId = adminHospital(actor);
  const [d] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!d) throw notFound("Department not found.");
  if (d.hospitalId !== hospitalId) throw forbidden("That department belongs to another hospital.");
  if (d.type !== "LABORATORY") throw badRequest("Only laboratory departments can accept requisitions from other hospitals.");
  await db.update(departments).set({ acceptsOutsideRequisitions: accepts }).where(eq(departments.id, departmentId));
  return { id: d.id, acceptsOutsideRequisitions: accepts };
}

export async function staffFormOptions(actor: Actor) {
  const hospitalId = adminHospital(actor);
  const depts = await db.select().from(departments).where(eq(departments.hospitalId, hospitalId)).orderBy(asc(departments.name));
  return { departments: depts.map((d) => ({ id: d.id, name: d.name, type: d.type })), hospitalIdHash: idHash(hospitalId) };
}

export { AppError };
