// Runs the test scenarios of seed/TEST_SCENARIOS.md against the real service code, an in-memory PostgreSQL
// and a local blockchain. Wallet signatures that a user would give in MetaMask are produced here with the
// same derived keys.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createWalletClient, http } from "viem";
import { prmsAbi } from "~/chain/abi";
import { db, getDbHandle } from "~/db/index.server";
import * as t from "~/db/schema";
import { checkContraindications } from "~/lib/engine";
import { loadActor, type Actor } from "~/server/actor.server";
import { accountAt, chain, contractAddress, idHash, read } from "~/server/chain.server";
import * as consent from "~/server/consent.server";
import { deployContract } from "~/server/deploy.server";
import * as lab from "~/server/lab.server";
import * as records from "~/server/records.server";
import * as registry from "~/server/registry.server";
import { seedAll } from "~/server/seed.server";
import cases from "../seed/data/prescription_test_cases.json";

let indexOf: Map<string, number>;
const silent = () => undefined;

/** Sign and send a contract call as a seeded user (or a raw account index), like MetaMask would. */
async function sign(who: string | number, functionName: string, args: unknown[]): Promise<string> {
  const { chain: c, publicClient, env } = chain();
  const index = typeof who === "number" ? who : indexOf.get(who)!;
  const wallet = createWalletClient({ chain: c, transport: http(env.rpcUrl), account: accountAt(index) });
  const hash = await wallet.writeContract({ address: contractAddress(), abi: prmsAbi, functionName: functionName as never, args: args as never });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
const walletOf = (userId: string) => accountAt(indexOf.get(userId)!).address;
const actor = (userId: string, hospitalId?: string): Promise<Actor> => loadActor(userId, hospitalId);
const refuses = async (p: Promise<unknown>, status: number) => {
  await expect(p).rejects.toMatchObject({ status });
};
const med = (drug: string, ongoing = false) => ({ drug, dose: "1 tab", frequency: "once daily", duration: "7 days", ongoing });
async function timeTravel(seconds: number) {
  const { env } = chain();
  for (const [method, params] of [["evm_increaseTime", [seconds]], ["evm_mine", []]] as const) {
    await fetch(env.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  }
}

const ADE = "usr_dr_adebayo", OKA = "usr_dr_okafor", BEL = "usr_dr_bello", DOUGLAS = "usr_dr_unverified", UMEH = "usr_dr_umeh";
const OJO = "usr_nurse_ojo", DAN = "usr_nurse_danjuma", HAEM = "usr_lab_haem", RAD = "usr_lab_rad";
const ADMIN_A = "usr_admin_a", REGISTRAR = "usr_registrar";

beforeAll(async () => {
  await getDbHandle().migrate();
  await deployContract(silent, false);
  const seeded = await seedAll({ log: silent, writeWalletFile: false });
  indexOf = seeded.indexOf;
});

describe("seed integrity", () => {
  it("every patient's hash chain verifies", async () => {
    for (const p of await db.select().from(t.patients)) expect((await records.verifyChain(p.id)).valid).toBe(true);
  });
  it("tampering with a record breaks the chain", async () => {
    await db.update(t.clinicalRecords).set({ notes: "altered" }).where(eq(t.clinicalRecords.id, "rec_0004"));
    expect((await records.verifyChain("pat_02")).valid).toBe(false);
    await db.update(t.clinicalRecords).set({ notes: "BP 168/102 on three visits. Commenced antihypertensives." }).where(eq(t.clinicalRecords.id, "rec_0004"));
    expect((await records.verifyChain("pat_02")).valid).toBe(true);
  });
});

describe("FR3 Contraindication Engine", () => {
  it("reproduces all 13 expected results from the seeded histories", async () => {
    for (const c of cases as Array<{ test_id: string; patient_id: string; proposed_drugs: string[]; proposed_diagnoses: string[]; treat_as_disputed: string[]; expected: string }>) {
      const rows = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.patientId, c.patient_id));
      const history = rows.map((r) => ({ id: r.id, status: c.treat_as_disputed.includes(r.id) ? "DISPUTED" : r.status, diagnosis: r.diagnosis, prescribed_medications: r.prescribedMedications }));
      const got = checkContraindications(history, c.proposed_drugs, c.proposed_diagnoses);
      expect(got.allowed ? "ALLOW" : "BLOCK:" + got.ruleId, c.test_id).toBe(c.expected);
    }
  });
  it("TC-FR3-01 blocks propranolol at Hospital B for asthma recorded at Hospital A, and saves nothing", async () => {
    const bello = await actor(BEL, "hosp_b");
    const before = (await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.patientId, "pat_01"))).length;
    const res = await records.createEntry(bello, "pat_01", { diagnoses: ["hypertension"], notes: "BP 158/98.", medications: [med("propranolol", true)] });
    expect(res.saved).toBe(false);
    if (!res.saved) {
      expect(res.conflict.ruleId).toBe("CR01");
      expect(res.conflict.recordedAtHospital).toContain("Oke-Ado Teaching Hospital");
    }
    expect((await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.patientId, "pat_01"))).length).toBe(before);
  });
  it("TC-FR3-03 saves a safe prescription and anchors it", async () => {
    const res = await records.createEntry(await actor(BEL, "hosp_b"), "pat_03", { diagnoses: ["malaria"], notes: "Fever.", medications: [med("artemether_lumefantrine"), med("paracetamol")] });
    expect(res.saved).toBe(true);
    if (res.saved) {
      expect(res.txHash).toMatch(/^0x/);
      expect(await read<string>("recordHash", [idHash(res.recordId)])).toBe("0x" + res.recordHash);
    }
    expect((await records.verifyChain("pat_03")).valid).toBe(true);
  });
});

describe("FR1 consent (Emeka Nwosu)", () => {
  let grantId = "";
  it("TC-FR1-01 a doctor's request leaves the history hidden and shows as pending", async () => {
    const okafor = await actor(OKA);
    await refuses(records.getTimeline(okafor, "pat_08"), 403);
    await consent.requestAccess(okafor, "pat_08");
    const list = await consent.listAccess(await actor("usr_pat_08"));
    expect(list.pending.map((p) => p.practitioner).sort()).toEqual(["Dr Chiamaka Okafor", "Dr Oluwaseun Adebayo"]);
    grantId = list.pending.find((p) => p.practitioner === "Dr Oluwaseun Adebayo")!.id;
  });
  it("TC-FR1-02/03 approval in the wallet opens the 5-record timeline", async () => {
    const emeka = await actor("usr_pat_08");
    await refuses(records.getTimeline(await actor(ADE), "pat_08"), 403);
    const tx = await sign("usr_pat_08", "grantAccess", [walletOf(ADE)]);
    const res = await consent.confirmGrant(emeka, grantId, tx);
    expect(res.status).toBe("GRANTED");
    const tl = await records.getTimeline(await actor(ADE), "pat_08");
    expect(tl.records.length).toBe(5);
    expect(new Set(tl.records.map((r) => r.hospitalId)).size).toBe(2);
  });
  it("a grant cannot be confirmed with someone else's transaction", async () => {
    const emeka = await actor("usr_pat_08");
    const other = (await consent.listAccess(emeka)).pending[0];
    const tx = await sign("usr_pat_08", "grantAccess", [walletOf(BEL)]); // grants Bello, not Okafor
    await refuses(consent.confirmGrant(emeka, other.id, tx), 400);
  });
  it("TC-FR1-04 revocation ends access", async () => {
    const emeka = await actor("usr_pat_08");
    const tx = await sign("usr_pat_08", "revokeAccess", [walletOf(ADE)]);
    await consent.confirmRevoke(emeka, grantId, tx);
    await refuses(records.getTimeline(await actor(ADE), "pat_08"), 403);
    const log = await consent.auditLog(emeka);
    expect(log.some((e) => e.kind === "REVOKE" && e.verifiedOnChain)).toBe(true);
  });
  it("TC-FR1-05 declining needs no transaction and grants nothing", async () => {
    const emeka = await actor("usr_pat_08");
    const pending = (await consent.listAccess(emeka)).pending.find((p) => p.practitioner === "Dr Chiamaka Okafor")!;
    await consent.declineRequest(emeka, pending.id);
    await refuses(records.getTimeline(await actor(OKA), "pat_08"), 403);
  });
  it("a patient cannot read another patient's record", async () => {
    await refuses(records.getTimeline(await actor("usr_pat_01"), "pat_08"), 403);
  });
});

describe("FR8 unified timeline", () => {
  it("TC-FR8 the patient sees both hospitals, with the disputed record linked to its correction", async () => {
    const tl = await records.getTimeline(await actor("usr_pat_08"), "pat_08");
    expect(tl.records.length).toBe(5);
    expect(tl.hospitals.length).toBe(2);
    expect(tl.records.find((r) => r.id === "rec_0019")!.status).toBe("DISPUTED");
    expect(tl.records.find((r) => r.id === "rec_0021")!.contradictsRecordId).toBe("rec_0019");
    const dates = tl.records.map((r) => r.timestamp);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("FR2 Glass-Break (Musa Ibrahim)", () => {
  it("TC-FR2-02 an unverified practitioner's override reverts", async () => {
    await expect(sign(DOUGLAS, "emergencyAccess", [walletOf("usr_pat_04"), idHash("hosp_b")])).rejects.toThrow(/Unauthorised practitioner/);
  });
  it("TC-FR2-01/03 a verified doctor's override opens the record and is on the audit log", async () => {
    const okafor = await actor(OKA);
    await refuses(records.getTimeline(okafor, "pat_04"), 403);
    const tx = await sign(OKA, "emergencyAccess", [walletOf("usr_pat_04"), idHash("hosp_a")]);
    await consent.confirmEmergencyAccess(okafor, "pat_04", tx);
    const tl = await records.getTimeline(okafor, "pat_04");
    expect(tl.records.some((r) => r.notes.includes("penicillin"))).toBe(true);
    const log = await consent.auditLog(await actor("usr_pat_04"));
    const entry = log.find((e) => e.kind === "OVERRIDE")!;
    expect(entry.licenseNo).toBe("MDCN/SEED/0002");
    expect(entry.verifiedOnChain).toBe(true);
  });
});

describe("FR4 Immutable Addendum (Folake Adeyemi)", () => {
  it("TC-FR3-06 an NSAID is blocked while the ulcer diagnosis is active", async () => {
    const res = await records.checkPrescription(await actor(BEL, "hosp_b"), "pat_05", { diagnoses: [], notes: "", medications: [med("ibuprofen")] });
    expect(res.conflict?.ruleId).toBe("CR03");
  });
  it("TC-FR4-01 the dispute adds a linked record, relabels the original and anchors the addendum", async () => {
    const before = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.id, "rec_0011"));
    const res = await records.disputeRecord(await actor(BEL, "hosp_b"), "rec_0011", { correctedDiagnoses: [], notes: "Endoscopy in February 2026 showed normal mucosa; findings consistent with reflux, not ulcer." });
    const [orig] = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.id, "rec_0011"));
    const [add] = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.id, res.addendumId));
    expect(orig.status).toBe("DISPUTED");
    expect(orig.notes).toBe(before[0].notes); // content untouched
    expect(orig.recordHash).toBe(before[0].recordHash);
    expect(add.contradictsRecordId).toBe("rec_0011");
    expect((await db.select().from(t.disputes).where(eq(t.disputes.newAddendumId, add.id))).length).toBe(1);
    expect(await read<string>("recordHash", [idHash(add.id)])).toBe("0x" + add.recordHash);
    expect((await records.verifyChain("pat_05")).valid).toBe(true);
  });
  it("TC-FR3-07 after the dispute the NSAID is allowed", async () => {
    const res = await records.checkPrescription(await actor(BEL, "hosp_b"), "pat_05", { diagnoses: [], notes: "", medications: [med("ibuprofen")] });
    expect(res.allowed).toBe(true);
  });
  it("a record cannot be disputed twice", async () => {
    await refuses(records.disputeRecord(await actor(BEL, "hosp_b"), "rec_0011", { correctedDiagnoses: [], notes: "Second attempt at the same record." }), 400);
  });
  it("TC-FR4-02 the service layer has no delete operation", () => {
    expect(Object.keys(records).some((k) => /delete|remove/i.test(k))).toBe(false);
  });
});

describe("FR5/FR6 laboratory workflow", () => {
  let fbc = "", cxr = "";
  it("TC-FR5-01 an order issues one token per department with separate lifetimes, registered on the ledger", async () => {
    const res = await lab.createRequisition(await actor(ADE), "pat_06", {
      targetHospitalId: "hosp_a",
      items: [{ departmentId: "dep_a_haematology", investigation: "Full blood count" }, { departmentId: "dep_a_radiology", investigation: "Chest X-ray, PA view" }],
      indication: "Query pneumonia.",
    });
    expect(res.requests.length).toBe(2);
    [fbc, cxr] = res.requests.map((r) => r.id);
    const hours = res.requests.map((r) => Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 3600_000));
    expect(hours).toEqual([24, 336]);
    for (const r of res.requests) expect(await read<boolean>("isTokenValid", ["0x" + r.tokenHash])).toBe(true);
  });
  it("TC-FR6-01 the Haematology queue shows only Haematology requisitions and no clinical history", async () => {
    const q = await lab.labQueue(await actor(HAEM));
    const codes = q.requests.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["LRQ-0001", "LRQ-0004", "LRQ-0005"]));
    expect(codes).not.toContain("LRQ-0002");
    expect(q.requests.find((r) => r.code === "LRQ-0004")!.expired).toBe(true);
    expect(JSON.stringify(q)).not.toMatch(/pneumonia"|diagnosis|prescribed/i);
    expect(q.requests[0].patient).toMatch(/^[A-Z]\. /); // initial and surname only
  });
  it("TC-FR6-02/03 a result is accepted once, anchored, and the token cannot be reused", async () => {
    const tech = await actor(HAEM);
    const req = await lab.labRequestForUpload(tech, "lrq_0001");
    const res = await lab.uploadResult(tech, "lrq_0001", { token: req.token!, result: "Hb 12.1 g/dL; WBC 14.2", comment: "Neutrophilia." });
    expect(res.txHash).toMatch(/^0x/);
    expect(await read<boolean>("isTokenValid", ["0x" + req.tokenHash])).toBe(false);
    await refuses(lab.uploadResult(tech, "lrq_0001", { token: req.token!, result: "again" }), 400);
    expect((await lab.labQueue(tech)).requests.map((r) => r.code)).not.toContain("LRQ-0001");
  });
  it("TC-FR6-04 an expired token is rejected", async () => {
    const tech = await actor(HAEM);
    const req = await lab.labRequestForUpload(tech, "lrq_0004");
    await refuses(lab.uploadResult(tech, "lrq_0004", { token: req.token!, result: "MTB not detected" }), 400);
  });
  it("TC-FR6-05 a technician cannot open or upload to another department's requisition", async () => {
    const tech = await actor(HAEM);
    await refuses(lab.labRequestForUpload(tech, "lrq_0002"), 403);
    await refuses(lab.uploadResult(tech, "lrq_0002", { token: "seed-secret-cxr-0002", result: "x" }), 403);
  });
  it("a wrong token is rejected", async () => {
    await refuses(lab.uploadResult(await actor(HAEM), "lrq_0005", { token: "guess", result: "x" }), 403);
  });
  it("TC-FR6-06 a technician cannot read a timeline", async () => {
    await refuses(records.getTimeline(await actor(HAEM), "pat_06"), 403);
  });
  it("TC-FR6-07 the ordering physician and the patient can open the result; another doctor sees it sealed", async () => {
    const mine = await lab.doctorOrders(await actor(ADE));
    expect(mine.find((o) => o.code === "LRQ-0001")!.result).toContain("Hb 12.1");
    const own = await records.getTimeline(await actor("usr_pat_06"), "pat_06");
    expect(own.labs.find((l) => l.code === "LRQ-0001")!.result).toContain("Hb 12.1");
    const tx = await sign("usr_pat_06", "grantAccess", [walletOf(OKA)]);
    expect(tx).toMatch(/^0x/);
    const other = await records.getTimeline(await actor(OKA), "pat_06");
    const sealed = other.labs.find((l) => l.code === "LRQ-0001")!;
    expect(sealed.result).toBeNull();
    expect(sealed.sealed).toBe(true);
  });
  it("the radiology technician can fulfil the imaging token created above", async () => {
    const rad = await actor(RAD);
    const req = await lab.labRequestForUpload(rad, cxr);
    expect((await lab.uploadResult(rad, cxr, { token: req.token!, result: "Right lower zone consolidation." })).code).toMatch(/^LRQ-/);
    expect(fbc).not.toBe("");
  });
});

describe("FR7 nursing (Halima Yusuf)", () => {
  it("TC-FR7-04 the ward list is the three admitted patients, and another hospital's nurse is refused", async () => {
    const ward = await records.wardList(await actor(OJO));
    expect(ward.patients.map((p) => p.bed)).toEqual(["02", "04", "07"]);
    await refuses(records.careSummary(await actor(DAN), "pat_07"), 403);
    await refuses(records.careSummary(await actor(OJO), "pat_01"), 403); // not admitted
  });
  it("TC-FR7-01 a nurse's vitals are saved under her name and anchored", async () => {
    const ojo = await actor(OJO);
    const res = await records.recordObservation(ojo, "pat_07", { vitals: { temperature_c: 36.9, pulse_bpm: 86, respiratory_rate: 18, blood_pressure: "138/90", spo2_percent: 98 }, notes: "Evening vitals." });
    const sum = await records.careSummary(ojo, "pat_07");
    expect(sum.observations[0].id).toBe(res.recordId);
    expect(sum.observations[0].author).toBe("Nurse Funmilayo Ojo");
    expect(sum.diagnoses).toContain("Pregnancy");
  });
  it("rejects impossible vital signs", async () => {
    await refuses(records.recordObservation(await actor(OJO), "pat_07", { vitals: { temperature_c: 99 }, notes: "" }), 400);
  });
  it("TC-FR7-02/03 a nurse cannot prescribe, dispute, order tests or read the full timeline", async () => {
    const ojo = await actor(OJO);
    await refuses(records.createEntry(ojo, "pat_07", { diagnoses: ["malaria"], notes: "x", medications: [] }), 403);
    await refuses(records.disputeRecord(ojo, "rec_0016", { correctedDiagnoses: [], notes: "not allowed for nurses" }), 403);
    await refuses(lab.createRequisition(ojo, "pat_07", { targetHospitalId: "hosp_a", items: [], indication: "" }), 403);
    await refuses(records.getTimeline(ojo, "pat_07"), 403);
  });
  it("TC-FR3-04/05 the engine blocks an ACE inhibitor in pregnancy and allows nifedipine", async () => {
    const okafor = await actor(OKA);
    const blocked = await records.createEntry(okafor, "pat_07", { diagnoses: [], notes: "BP still high.", medications: [med("lisinopril", true)] });
    expect(blocked.saved).toBe(false);
    const ok = await records.createEntry(okafor, "pat_07", { diagnoses: [], notes: "BP still high.", medications: [med("nifedipine", true)] });
    expect(ok.saved).toBe(true);
  });
  it("a doctor can admit a patient to a ward of the working hospital only", async () => {
    const bello = await actor(BEL, "hosp_b");
    await refuses(records.createEntry(bello, "pat_03", { diagnoses: [], notes: "Admit.", medications: [], admission: { departmentId: "dep_a_medical_ward" } }), 400);
    const ok = await records.createEntry(bello, "pat_03", { diagnoses: [], notes: "Admit for observation.", medications: [], admission: { departmentId: "dep_b_emergency_ward", bed: "01" } });
    expect(ok.saved && ok.admittedTo).toBe("Emergency Ward");
    expect((await records.wardList(await actor(DAN))).patients.map((p) => p.patientId)).toContain("pat_03");
  });
});

describe("FR9 admitting a hospital (registrar)", () => {
  it("TC-FR9-02 the contract rejects an admin wallet that is already bound", async () => {
    const reg = await actor(REGISTRAR);
    const app = (await registry.registryOverview(reg)).applications.find((a) => a.reference === "HSP-APP-0010")!;
    expect(app.walletBoundTo).toBe("HSP-0003");
    await expect(sign(REGISTRAR, "registerHospital", [app.plannedIdHash, app.adminWallet])).rejects.toThrow(/already bound/);
  });
  it("TC-FR9-01 approval records the hospital and lets its administrator in", async () => {
    const reg = await actor(REGISTRAR);
    const app = (await registry.registryOverview(reg)).applications.find((a) => a.reference === "HSP-APP-0009")!;
    const tx = await sign(REGISTRAR, "registerHospital", [app.plannedIdHash, app.adminWallet]);
    const res = await registry.confirmHospitalApproval(reg, app.id, tx);
    expect(res.code).toBe("HSP-0009");
    const [admin] = await db.select().from(t.users).where(eq(t.users.email, "h.mohammed@prms.test"));
    const hauwa = await actor(admin.id);
    expect(hauwa.role).toBe("hospital_admin");
    const profile = await registry.hospitalProfile(hauwa);
    expect(profile.departments.map((d) => d.name).sort()).toEqual(["Haematology", "Radiology"]);
    expect((await registry.registryOverview(reg)).hospitals.length).toBe(9);
  });
  it("only the registrar's wallet can register a hospital", async () => {
    await expect(sign(ADMIN_A, "registerHospital", [idHash("hosp_x"), walletOf(UMEH)])).rejects.toThrow(/Only the registrar/);
  });
  it("TC-FR9-03 the registrar cannot see staff or patients", async () => {
    const reg = await actor(REGISTRAR);
    await refuses(registry.listStaff(reg), 403);
    await refuses(records.getTimeline(reg, "pat_01"), 403);
    expect(JSON.stringify(await registry.registryOverview(reg))).not.toMatch(/Adebayo|MDCN/);
  });
  it("a public application is validated and queued", async () => {
    await refuses(registry.submitApplication({ name: "X", city: "Y", state: "Z", level: "secondary", facilityRegistrationNo: "N", departments: [], adminName: "A", adminEmail: "a@b.c", adminWallet: "nope", adminPassword: "password1" }), 400);
    const res = await registry.submitApplication({ name: "Delta Clinic", city: "Asaba", state: "Delta", level: "primary", facilityRegistrationNo: "DT/1", departments: ["Haematology"], adminName: "Ada Obi", adminEmail: "ada@delta.test", adminWallet: accountAt(58).address, adminPassword: "password1" });
    expect(res.reference).toBe("HSP-APP-0011");
  });
});

describe("FR10 hospital administration (Hospital A)", () => {
  it("TC-FR10-01..03 a practitioner gains the override only after her own administrator verifies her", async () => {
    await expect(sign(UMEH, "emergencyAccess", [walletOf("usr_pat_02"), idHash("hosp_a")])).rejects.toThrow(/Unauthorised/);
    const kemi = await actor(ADMIN_A);
    const staff = (await registry.listStaff(kemi)).staff;
    const umeh = staff.find((s) => s.userId === UMEH)!;
    expect(umeh.status).toBe("PENDING_VERIFICATION");
    const target = await registry.staffTxTarget(kemi, umeh.affiliationId);
    const tx = await sign(ADMIN_A, "verifyPractitioner", [target.wallet, target.licenseNo]);
    await registry.confirmStaffVerification(kemi, umeh.affiliationId, tx);
    expect(await read<boolean>("isVerifiedAt", [walletOf(UMEH), idHash("hosp_a")])).toBe(true);
    const tx2 = await sign(UMEH, "emergencyAccess", [walletOf("usr_pat_02"), idHash("hosp_a")]);
    await consent.confirmEmergencyAccess(await actor(UMEH), "pat_02", tx2);
    expect((await records.getTimeline(await actor(UMEH), "pat_02")).records.length).toBeGreaterThan(0);
  });
  it("TC-FR10-04 the staff list holds Hospital A only, including the visiting consultant", async () => {
    const staff = (await registry.listStaff(await actor(ADMIN_A))).staff;
    expect(staff.map((s) => s.name)).toContain("Dr Aminu Bello");
    expect(staff.find((s) => s.name === "Dr Aminu Bello")!.alsoAt).toEqual(["Mainland General Hospital"]);
    expect(staff.map((s) => s.name)).not.toContain("Dr Tari Douglas");
    expect(staff.length).toBe(7);
  });
  it("TC-FR10-05 an administrator cannot act on another hospital's practitioner", async () => {
    const kemi = await actor(ADMIN_A);
    const [aff] = await db.select().from(t.staffAffiliations).where(eq(t.staffAffiliations.userId, DOUGLAS));
    await refuses(registry.staffTxTarget(kemi, aff.id), 403);
    // On the contract, her signature would verify him at HER hospital, never at his.
    await sign(ADMIN_A, "verifyPractitioner", [walletOf(DOUGLAS), "MDCN/SEED/0004"]);
    expect(await read<boolean>("isVerifiedAt", [walletOf(DOUGLAS), idHash("hosp_b")])).toBe(false);
  });
  it("TC-FR10-06 a suspended technician cannot upload until re-verified", async () => {
    const kemi = await actor(ADMIN_A);
    const zainab = (await registry.listStaff(kemi)).staff.find((s) => s.userId === RAD)!;
    await registry.confirmStaffSuspension(kemi, zainab.affiliationId, await sign(ADMIN_A, "suspendPractitioner", [walletOf(RAD)]));
    const req = await lab.labRequestForUpload(await actor(RAD), "lrq_0002");
    await refuses(lab.uploadResult(await actor(RAD), "lrq_0002", { token: req.token!, result: "Clear lung fields." }), 403);
    await registry.confirmStaffVerification(kemi, zainab.affiliationId, await sign(ADMIN_A, "verifyPractitioner", [walletOf(RAD), "MLSCN/SEED/0002"]));
    const ok = await lab.uploadResult(await actor(RAD), "lrq_0002", { token: req.token!, result: "Clear lung fields." });
    expect(ok.code).toBe("LRQ-0002");
  });
  it("TC-FR10-07 an administrator cannot read a patient record", async () => {
    await refuses(records.getTimeline(await actor(ADMIN_A), "pat_01"), 403);
    await refuses(consent.searchPatients(await actor(ADMIN_A), ""), 403);
  });
  it("an administrator can add a practitioner, who starts unverified", async () => {
    const kemi = await actor(ADMIN_A);
    const res = await registry.addStaff(kemi, { name: "Dr Tolani Ajayi", email: "t.ajayi@prms.test", password: "Prms@Demo2026", role: "doctor", departmentId: "dep_a_paediatrics", licenseNo: "MDCN/SEED/0099", wallet: accountAt(57).address });
    const row = (await registry.listStaff(kemi)).staff.find((s) => s.affiliationId === res.affiliationId)!;
    expect(row.status).toBe("PENDING_VERIFICATION");
    await refuses(consent.requestAccess(await actor(res.userId), "pat_01"), 403);
    await refuses(registry.addStaff(kemi, { name: "N", email: "n@prms.test", password: "Prms@Demo2026", role: "nurse", departmentId: "dep_a_haematology", licenseNo: "N1", wallet: accountAt(56).address }), 400);
  });
});

describe("FR11 routing a laboratory order / FR13 departments", () => {
  it("TC-FR11-01 and TC-FR13-02 only open laboratories of other hospitals are offered", async () => {
    const list = await lab.labDestinations(await actor(BEL, "hosp_b"));
    const names = list.map((h) => h.name);
    expect(list[0].own).toBe(true);
    expect(names).not.toContain("Aso Valley District Hospital");
    expect(names).not.toContain("Ancient City Specialist Hospital");
    const okeAdo = list.find((h) => h.id === "hosp_a")!.departments.map((d) => d.name);
    expect(okeAdo).toEqual(["Haematology", "Medical Microbiology", "Radiology"]);
  });
  it("TC-FR11-02 an order sent to Hospital A reaches Hospital A's Haematology queue only", async () => {
    const res = await lab.createRequisition(await actor(BEL, "hosp_b"), "pat_08", { targetHospitalId: "hosp_a", items: [{ departmentId: "dep_a_haematology", investigation: "Full blood count" }], indication: "Review." });
    const code = res.requests[0].code;
    expect((await lab.labQueue(await actor(HAEM))).requests.map((r) => r.code)).toContain(code);
    expect((await lab.labQueue(await actor("usr_lab_c"))).requests.map((r) => r.code)).not.toContain(code);
  });
  it("TC-FR11-03 a requisition to a closed laboratory is rejected", async () => {
    await refuses(lab.createRequisition(await actor(BEL, "hosp_b"), "pat_08", { targetHospitalId: "hosp_f", items: [{ departmentId: "dep_f_haematology", investigation: "Full blood count" }], indication: "" }), 403);
    await refuses(lab.createRequisition(await actor(BEL, "hosp_b"), "pat_08", { targetHospitalId: "hosp_a", items: [{ departmentId: "dep_a_chemical_pathology", investigation: "Fasting blood glucose" }], indication: "" }), 403);
  });
  it("TC-FR13-01/03 the administrator adds a department and opens Chemical Pathology", async () => {
    const kemi = await actor(ADMIN_A);
    const d = await registry.addDepartment(kemi, { name: "Histopathology", type: "LABORATORY" });
    await refuses(registry.addDepartment(kemi, { name: "histopathology", type: "LABORATORY" }), 400);
    const before = (await lab.labDestinations(await actor(BEL, "hosp_b"))).find((h) => h.id === "hosp_a")!.departments.map((x) => x.name);
    expect(before).not.toContain("Histopathology");
    await registry.setDepartmentSharing(kemi, "dep_a_chemical_pathology", true);
    const after = (await lab.labDestinations(await actor(BEL, "hosp_b"))).find((h) => h.id === "hosp_a")!.departments.map((x) => x.name);
    expect(after).toContain("Chemical Pathology");
    expect((await registry.staffFormOptions(kemi)).departments.map((x) => x.id)).toContain(d.id);
  });
  it("TC-FR13-04 an administrator cannot change another hospital's department or list the network", async () => {
    const kemi = await actor(ADMIN_A);
    await refuses(registry.setDepartmentSharing(kemi, "dep_b_haematology", false), 403);
    await refuses(registry.registryOverview(kemi), 403);
    expect(JSON.stringify(await registry.hospitalProfile(kemi))).not.toMatch(/Mainland|Harmattan/);
  });
});

describe("FR12 working hospital", () => {
  it("TC-FR12-01 an entry is recorded under the hospital the doctor is working at", async () => {
    const atA = await actor(BEL, "hosp_a");
    expect(atA.affiliations.length).toBe(2);
    const res = await records.createEntry(atA, "pat_02", { diagnoses: [], notes: "Seen at Oke-Ado as visiting consultant.", medications: [] });
    expect(res.saved).toBe(true);
    if (res.saved) {
      const [row] = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.id, res.recordId));
      expect(row.hospitalId).toBe("hosp_a");
    }
  });
  it("TC-FR12-02 a doctor with one affiliation has one hospital", async () => {
    expect((await actor(ADE)).affiliations.length).toBe(1);
  });
});

describe("expiry (run last: these move the chain's clock)", () => {
  it("TC-FR2-04 emergency access ends after one hour", async () => {
    const okafor = await actor(OKA);
    expect((await records.getTimeline(okafor, "pat_04")).records.length).toBeGreaterThan(0);
    await timeTravel(3700);
    await refuses(records.getTimeline(okafor, "pat_04"), 403);
  });
  it("consent ends after 24 hours", async () => {
    const bello = await actor(BEL, "hosp_b");
    expect((await records.getTimeline(bello, "pat_10")).records.length).toBeGreaterThan(0);
    await timeTravel(24 * 3600);
    await refuses(records.getTimeline(bello, "pat_10"), 403);
  });
  it("a hospital suspended by the registrar loses its practitioners' standing", async () => {
    const tx = await sign(REGISTRAR, "setHospitalActive", [idHash("hosp_c"), false]);
    await registry.confirmHospitalStatus(await actor(REGISTRAR), "hosp_c", tx);
    expect(await read<boolean>("isVerifiedAt", [walletOf("usr_dr_c"), idHash("hosp_c")])).toBe(false);
    await refuses(consent.requestAccess(await actor("usr_dr_c"), "pat_01"), 403);
  });
});
