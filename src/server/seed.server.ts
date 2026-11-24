// Loads the synthetic data in seed/data into the database and puts the matching state on the smart contract.
// Every person, hospital and licence number in that data is invented.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createWalletClient, formatEther, parseEther, toHex } from "viem";
import { prmsAbi } from "~/chain/abi";
import { db } from "~/db/index.server";
import * as t from "~/db/schema";
import { accountAt, chain, contractAddress, FIRST_USER_INDEX, hexHash, idHash, read, REGISTRAR_INDEX, relay, RELAYER_INDEX, rpcTransport } from "./chain.server";
import { getEnv } from "./env.server";
import { childTokenHash } from "./lab.server";
import { buildRecord } from "./records.server";
import { createUserWithPassword } from "./registry.server";
import { encryptFor, setCounterAtLeast, sha256 } from "./util.server";

type Json = Record<string, any>;
const load = (name: string): Json[] => JSON.parse(readFileSync(resolve(process.cwd(), "seed", "data", name), "utf8"));
const clean = (name: string) => name.replace(" (fictional)", "");

export type SeedWallet = { index: number; label: string; role: string; email: string | null; address: string; privateKey: string };

export async function seedAll(opts: { log?: (m: string) => void; writeWalletFile?: boolean } = {}) {
  const log = opts.log ?? console.log;
  const env = getEnv();
  const { publicClient, chain: viemChain } = chain();
  const transport = rpcTransport();
  const walletFor = (index: number) => createWalletClient({ chain: viemChain, transport, account: accountAt(index) });

  /** Send a contract call from one of the derived wallets and wait for it. */
  const send = async (index: number, functionName: string, args: unknown[]) => {
    const hash = await walletFor(index).writeContract({ address: contractAddress(), abi: prmsAbi, functionName: functionName as never, args: args as never });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} failed on the ledger`);
    return hash;
  };

  const users = load("users.json");
  const hospitals = load("hospitals.json");
  const applications = load("hospital_applications.json");

  // ---- one wallet per seeded user, all derived from WALLET_MNEMONIC
  const wallets: SeedWallet[] = [];
  const indexOf = new Map<string, number>();
  const hex = (i: number) => toHex(accountAt(i).getHdKey().privateKey!);
  wallets.push({ index: RELAYER_INDEX, label: "Server relayer (anchors records; do not import)", role: "relayer", email: null, address: accountAt(RELAYER_INDEX).address, privateKey: hex(RELAYER_INDEX) });
  let next = FIRST_USER_INDEX;
  for (const u of users) {
    const index = u.role === "registrar" ? REGISTRAR_INDEX : next++;
    indexOf.set(u.id, index);
    wallets.push({ index, label: u.name, role: u.role, email: u.email, address: accountAt(index).address, privateKey: hex(index) });
  }
  const addr = (userId: string) => accountAt(indexOf.get(userId)!).address.toLowerCase();

  const already = await read<readonly [string, boolean, boolean]>("hospitals", [idHash(hospitals[0].id)]);
  if (already[1]) {
    throw new Error("This contract has already been seeded. Deploy a fresh one first:  pnpm contract:deploy   (or run  pnpm bootstrap  to do everything).");
  }

  // ---- Sepolia: give every seeded wallet a little test ETH for gas
  if (env.chain === "sepolia") {
    const amount = parseEther(env.seedFundEth);
    const funder = walletFor(REGISTRAR_INDEX);
    log(`Funding ${wallets.length - 1} wallets with up to ${env.seedFundEth} ETH each from ${funder.account.address} ...`);
    for (const w of wallets) {
      if (w.index === REGISTRAR_INDEX || w.index === RELAYER_INDEX) continue;
      const have = await publicClient.getBalance({ address: w.address as `0x${string}` });
      if (have >= amount) continue;
      const hash = await funder.sendTransaction({ to: w.address as `0x${string}`, value: amount - have });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
    }
    log(`Registrar balance after funding: ${formatEther(await publicClient.getBalance({ address: funder.account.address }))} ETH`);
  }

  // ---- empty the database (the seed can be run again on a fresh contract)
  await db.execute(sql`TRUNCATE TABLE lab_results, lab_requests, disputes, clinical_records, admissions, access_grants, patients,
    staff_affiliations, departments, hospital_applications, hospitals, sessions, accounts, verifications, users, counters RESTART IDENTITY CASCADE`);

  // ---- accounts
  log("Creating accounts ...");
  const passwordHash = await hashPassword(users[0].password);
  for (const u of users) {
    await createUserWithPassword({ id: u.id, name: u.name, email: u.email, passwordHash, role: u.role, licenseNo: u.medical_license_no, wallet: addr(u.id) });
  }

  // ---- hospitals: recorded in the database and admitted on the contract by the registrar
  log("Registering hospitals on the ledger ...");
  for (const h of hospitals) {
    const adminWallet = addr(h.admin_user_id);
    const tx = await send(REGISTRAR_INDEX, "registerHospital", [idHash(h.id), adminWallet]);
    await db.insert(t.hospitals).values({
      id: h.id, code: h.code, name: clean(h.name), city: h.city, state: h.state, level: h.level,
      facilityRegistrationNo: h.facility_registration_no, adminUserId: h.admin_user_id, adminWallet, registeredTx: tx,
    });
  }
  for (const d of load("departments.json")) {
    await db.insert(t.departments).values({ id: d.id, hospitalId: d.hospital_id, name: d.name, type: d.type, acceptsOutsideRequisitions: d.accepts_outside_requisitions, status: d.status });
  }

  // ---- staff: each verified practitioner is verified on the contract by his or her own hospital's administrator
  log("Verifying practitioners on the ledger ...");
  const adminOf = new Map(hospitals.map((h) => [h.id as string, h.admin_user_id as string]));
  const userById = new Map(users.map((u) => [u.id as string, u]));
  for (const a of load("staff_affiliations.json")) {
    const u = userById.get(a.user_id)!;
    let verifiedTx: string | null = null;
    if (u.role !== "hospital_admin" && a.is_verified_on_chain) {
      verifiedTx = await send(indexOf.get(adminOf.get(a.hospital_id)!)!, "verifyPractitioner", [addr(u.id), u.medical_license_no]);
    }
    await db.insert(t.staffAffiliations).values({
      id: a.id, userId: a.user_id, hospitalId: a.hospital_id, departmentId: a.department_id,
      position: u.role === "hospital_admin" ? "Hospital administrator" : a.position, verifiedTx, status: a.status,
    });
  }

  // ---- two applications waiting for the registrar
  const hospC = hospitals.find((h) => h.id === "hosp_c")!;
  for (const a of applications) {
    let wallet: string;
    if (String(a.admin_wallet ?? "").startsWith("SAME AS")) wallet = addr(hospC.admin_user_id); // must be rejected: wallet already bound
    else {
      const index = next++;
      wallet = accountAt(index).address.toLowerCase();
      wallets.push({ index, label: `${a.admin_name} (administrator named in application ${a.reference})`, role: "hospital_admin (after approval)", email: a.admin_email, address: wallet, privateKey: hex(index) });
    }
    await db.insert(t.hospitalApplications).values({
      id: a.id, reference: a.reference, name: clean(a.name), city: a.city, state: a.state, level: a.level,
      facilityRegistrationNo: a.facility_registration_no, departments: a.laboratory_departments, adminName: a.admin_name,
      adminEmail: a.admin_email, adminWallet: wallet, adminPasswordHash: passwordHash,
    });
  }

  // ---- patients
  for (const p of load("patients.json")) {
    await db.insert(t.patients).values({
      id: p.id, userId: p.user_id, code: "PT-" + p.id.replace("pat_", "").padStart(4, "0"), globalHealthHash: p.global_health_hash,
      dateOfBirth: p.date_of_birth, sex: p.sex, bloodGroup: p.blood_group, genotype: p.genotype,
    });
  }

  // ---- clinical records: hash-chained per patient in file order, each hash anchored on the ledger
  const records = load("clinical_records.json");
  log(`Anchoring ${records.length} clinical records ...`);
  for (const r of records) {
    const row = await buildRecord({
      id: r.id, patientId: r.patient_id, hospitalId: r.hospital_id, authorId: r.author_id, recordType: r.record_type,
      diagnosis: r.diagnosis, prescribedMedications: r.prescribed_medications, notes: r.notes, vitals: r.vitals,
      contradictsRecordId: r.contradicts_record_id, timestamp: new Date(r.timestamp), status: r.status,
    });
    const txHash = r.contradicts_record_id
      ? await relay("anchorAddendum", [idHash(r.contradicts_record_id), idHash(row.id), hexHash(row.recordHash), idHash(row.hospitalId)])
      : await relay("anchorRecord", [idHash(row.id), hexHash(row.recordHash), idHash(row.hospitalId)]);
    await db.insert(t.clinicalRecords).values({ ...row, txHash });
  }
  const recordTx = new Map((await db.select({ id: t.clinicalRecords.id, tx: t.clinicalRecords.txHash }).from(t.clinicalRecords)).map((r) => [r.id, r.tx]));
  for (const d of load("disputes.json")) {
    await db.insert(t.disputes).values({
      id: d.id, originalRecordId: d.original_record_id, newAddendumId: d.new_addendum_id, practitionerId: d.practitioner_id,
      txHash: recordTx.get(d.new_addendum_id) ?? null, createdAt: new Date(d.created_at),
    });
  }

  // ---- laboratory requisitions: token hashes registered on the ledger; expiry is relative to now
  log("Registering laboratory tokens ...");
  const now = Date.now();
  const labRequests = load("lab_requests.json");
  for (const q of labRequests) {
    const hash = childTokenHash(q.parent_requisition_id, q.department_id, q.token_secret_DEMO_ONLY);
    const expiresAt = new Date(now + q.expires_in_hours_from_seed * 3600_000);
    const txHash = await relay("registerToken", [hexHash(hash), idHash(q.department_id), BigInt(Math.floor(expiresAt.getTime() / 1000))]);
    await db.insert(t.labRequests).values({
      id: q.id, code: "LRQ-" + q.id.replace("lrq_", ""), parentRequisitionId: q.parent_requisition_id, patientId: q.patient_id,
      orderingPhysicianId: q.ordering_physician_id, orderingHospitalId: q.ordering_hospital_id, targetHospitalId: q.target_hospital_id,
      departmentId: q.department_id, investigation: q.investigation, specimen: q.specimen, clinicalIndication: q.clinical_indication,
      orderedAt: new Date(q.ordered_at), tokenSecret: q.token_secret_DEMO_ONLY, childTokenHash: hash, expiresAt, txHash, status: q.status,
    });
  }
  const physicianOf = new Map(labRequests.map((q) => [q.id as string, q.ordering_physician_id as string]));
  const testOf = new Map(labRequests.map((q) => [q.id as string, q.investigation as string]));
  for (const r of load("lab_results.json")) {
    const { comment, ...values } = r.result_payload as Json;
    const text = Object.entries(values).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ");
    const plaintext = JSON.stringify({ result: text, comment: comment ?? "", investigation: testOf.get(r.request_id) });
    // This historic result is not anchored: its token expired before seeding, as it would have in real use.
    await db.insert(t.labResults).values({
      id: r.id, requestId: r.request_id, technicianId: r.technician_id, resultPayload: encryptFor(physicianOf.get(r.request_id)!, plaintext),
      resultHash: sha256(plaintext), txHash: null, uploadedAt: new Date(r.uploaded_at),
    });
  }

  for (const a of load("admissions.json")) {
    await db.insert(t.admissions).values({
      id: a.id, patientId: a.patient_id, hospitalId: a.hospital_id, departmentId: a.department_id, bed: a.bed, reason: a.reason,
      admittedBy: a.admitted_by, admittedAt: new Date(a.admitted_at), dischargedAt: a.discharged_at ? new Date(a.discharged_at) : null, status: a.status,
    });
  }

  // ---- consent: live grants are signed by each patient's own wallet; historic rows are off-chain history
  log("Recording patient consent on the ledger ...");
  const patientUser = new Map(load("patients.json").map((p) => [p.id as string, p.user_id as string]));
  for (const g of load("access_grants.json")) {
    const requestedAt = g.requested_at ? new Date(g.requested_at) : new Date(now - (g.requested_hours_before_seed ?? 0) * 3600_000);
    let txHash: string | null = null;
    let decidedAt: Date | null = g.decided_at ? new Date(g.decided_at) : null;
    let expiresAt: Date | null = g.expires_at ? new Date(g.expires_at) : null;
    if (g.status === "GRANTED") {
      txHash = await send(indexOf.get(patientUser.get(g.patient_id)!)!, "grantAccess", [addr(g.practitioner_id)]);
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      decidedAt = new Date(Number(block.timestamp) * 1000);
      expiresAt = new Date(decidedAt.getTime() + 24 * 3600_000);
    }
    await db.insert(t.accessGrants).values({
      id: g.id, patientId: g.patient_id, practitionerId: g.practitioner_id, hospitalId: g.hospital_id, grantType: g.grant_type,
      status: g.status, requestedAt, decidedAt, expiresAt, txHash,
    });
  }

  await setCounterAtLeast("patient", 10);
  await setCounterAtLeast("lab_request", labRequests.length);
  await setCounterAtLeast("application", 10);

  wallets.sort((a, b) => a.index - b.index);
  if (opts.writeWalletFile !== false) {
    writeFileSync(resolve(process.cwd(), "wallets.local.json"), JSON.stringify({ chain: env.chain, password: users[0].password, wallets }, null, 2) + "\n");
  }
  log(`Seeded ${users.length} accounts, ${hospitals.length} hospitals, ${records.length} records.`);
  return { wallets, indexOf, password: users[0].password as string };
}
