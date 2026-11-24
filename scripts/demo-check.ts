// Checks, without changing anything, that the database and the smart contract are ready for the ten-minute
// demonstration in the README (section 2). Run it on the day of a presentation:  pnpm demo:check
import { and, eq, inArray } from "drizzle-orm";
import { formatEther } from "viem";
import { db, getDbHandle } from "~/db/index.server";
import * as t from "~/db/schema";
import { chain, contractAddress, hasAccessOnChain, idHash, isTokenValidOnChain, isVerifiedOnChain, read, rpcLabel } from "~/server/chain.server";
import { finish, reason } from "./finish";

let problems = 0;
const ok = (text: string) => console.log(`   OK       ${text}`);
const bad = (text: string, fix: string) => {
  problems++;
  console.log(`   PROBLEM  ${text}\n            Fix: ${fix}`);
};
const note = (text: string) => console.log(`   note     ${text}`);
const check = (good: boolean, okText: string, badText: string, fix: string) => (good ? ok(okText) : bad(badText, fix));
const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

async function main() {
  const env = chain().env;
  const { publicClient } = chain();
  // The contract decides expiry by the time of the latest block, so compare against that, not this computer.
  const chainNow = Number((await publicClient.getBlock()).timestamp) * 1000;
  console.log(`Chain ${env.chain} via ${rpcLabel()}, contract ${contractAddress()}, database: ${getDbHandle().kind}\n`);

  // ---- the people of the demonstration, as the app knows them (wallet = users.public_key)
  const emails = ["registrar", "emeka", "musa", "adaeze", "folake", "dr_bello", "dr_okafor", "dr_adebayo", "nurse_ojo", "lab_haem", "lab_rad", "admin_a"];
  const rows = await db.select().from(t.users).where(inArray(t.users.email, emails.map((e) => `${e}@prms.test`)));
  const who = Object.fromEntries(rows.map((u) => [u.email.replace("@prms.test", ""), u]));
  for (const e of emails) if (!who[e]) throw new Error(`${e}@prms.test is not in the database. Is DATABASE_URL pointing at the seeded database?`);
  const wallet = (e: string) => who[e].publicKey as `0x${string}`;
  const access = (patient: string, doctor: string) => hasAccessOnChain(wallet(patient), wallet(doctor));

  // ---- gas: every MetaMask signature costs a little test ETH
  console.log("Test ETH for the wallets that sign in MetaMask");
  // MetaMask asks for gas limit x maximum fee up front; 2 x the current price and 150,000 gas is a safe allowance.
  const perTx = (await publicClient.getGasPrice()) * 2n * 150_000n;
  const signers: [string, string][] = [
    ["registrar", "approves Lakeside"], ["emeka", "approves then revokes"], ["dr_okafor", "emergency override"],
    ["admin_a", "verifies Dr Umeh"], ["musa", "(only reads)"], ["adaeze", "(only reads)"],
  ];
  for (const [e, use] of signers) {
    const bal = await publicClient.getBalance({ address: wallet(e) });
    const n = perTx > 0n ? bal / perTx : 9999n;
    const text = `${e.padEnd(10)} ${formatEther(bal).slice(0, 9).padEnd(9)} ETH, about ${n > 999n ? "1000+" : n} transactions  ${use}`;
    if (use.startsWith("(") || n >= 5n) ok(text);
    else bad(text, `send it 0.002 Sepolia ETH from the registrar account in MetaMask.`);
  }
  const relayer = await publicClient.getBalance({ address: (await read<string>("relayer", [])) as `0x${string}` });
  const rn = perTx > 0n ? relayer / perTx : 9999n;
  check(rn >= 30n, `relayer    ${formatEther(relayer).slice(0, 9)} ETH (the server pays for saving entries, lab orders and results)`,
    `relayer has only ${formatEther(relayer)} ETH`, "send it 0.01 Sepolia ETH from the registrar account (run  pnpm wallets  for its address).");

  // ---- 1. Cross-facility block
  console.log("\n1. Cross-facility block: dr_bello adds an entry for Adaeze");
  check(await isVerifiedOnChain(wallet("dr_bello"), "hosp_b"), "dr_bello is verified at Mainland General on the contract", "dr_bello is not verified at Mainland General", "verify dr_bello as admin_b.");
  const belloAdaeze = await access("adaeze", "dr_bello");
  check(belloAdaeze, "dr_bello can open Adaeze's record", "dr_bello's consent to read Adaeze has run out (consent lasts 24 hours)", "run  pnpm demo:refresh  on the day of the presentation.");

  // ---- 2. Consent
  console.log("\n2. Consent: emeka approves Dr Adebayo, then revokes");
  const [emekaPatient] = await db.select().from(t.patients).where(eq(t.patients.userId, who.emeka.id));
  const pending = await db.select().from(t.accessGrants)
    .where(and(eq(t.accessGrants.patientId, emekaPatient.id), eq(t.accessGrants.practitionerId, who.dr_adebayo.id), eq(t.accessGrants.status, "PENDING")));
  check(pending.length > 0, "Dr Adebayo's request is waiting on Emeka's Access page", "there is no waiting request from Dr Adebayo (it was answered in a rehearsal)",
    "sign in as dr_adebayo@prms.test, Patients, Emeka Nwosu, Request access. Or run  pnpm demo:refresh.");
  check(await isVerifiedOnChain(wallet("dr_adebayo"), "hosp_a"), "Dr Adebayo is verified, so the contract accepts the grant", "Dr Adebayo is not verified on the contract", "verify Dr Adebayo as admin_a.");

  // ---- 3. Emergency override
  console.log("\n3. Emergency override: dr_okafor opens Musa's record");
  check(await isVerifiedOnChain(wallet("dr_okafor"), "hosp_a"), "dr_okafor is verified at Oke-Ado", "dr_okafor is not verified at Oke-Ado", "verify dr_okafor as admin_a.");
  const consent = await read<bigint>("consentExpiry", [wallet("musa"), wallet("dr_okafor")]);
  check(Number(consent) * 1000 <= chainNow, "Musa has not given dr_okafor consent, so the override is logged as an emergency",
    "Musa has given dr_okafor consent, so no override is needed or logged", "wait for the consent to end, or revoke it as musa.");
  if (await access("musa", "dr_okafor")) note("An override from a rehearsal is still open (it lasts one hour). The button still works and logs a new entry.");

  // ---- 4. Immutable addendum
  console.log("\n4. Dispute: dr_bello disputes Folake's peptic ulcer entry");
  const [ulcer] = await db.select().from(t.clinicalRecords).where(eq(t.clinicalRecords.id, "rec_0011"));
  check(ulcer?.status === "ACTIVE", "the peptic ulcer entry (Oke-Ado, 2024) can still be disputed", `the peptic ulcer entry is already ${ulcer?.status ?? "missing"} (disputed in a rehearsal)`,
    "an entry can be disputed only once. Show the existing dispute instead (Emeka's timeline has one), or reseed for a clean slate.");
  check(await access("folake", "dr_bello"), "dr_bello can open Folake's record", "dr_bello's consent to read Folake has run out", "run  pnpm demo:refresh  on the day of the presentation.");

  // ---- 5. Laboratory
  console.log("\n5. Laboratory: dr_bello orders a Full blood count for Adaeze; lab_haem uploads it");
  if (!belloAdaeze) bad("dr_bello cannot order for Adaeze without access (see step 1)", "run  pnpm demo:refresh.");
  else ok("dr_bello can order for Adaeze");
  const [haem] = await db.select().from(t.departments).where(eq(t.departments.id, "dep_a_haematology"));
  check(haem?.status === "ACTIVE" && haem.acceptsOutsideRequisitions === true, "Oke-Ado Haematology accepts requisitions from other hospitals",
    "Oke-Ado Haematology does not accept outside requisitions", "as admin_a, Hospital, turn sharing on for Haematology.");
  // Technicians never sign in MetaMask, but the server uploads a result only for staff verified on the contract.
  for (const [e, unit] of [["lab_haem", "Haematology"], ["lab_rad", "Radiology"]] as const) {
    check(await isVerifiedOnChain(wallet(e), "hosp_a"), `${e} (Oke-Ado ${unit}) is verified on the contract, so uploads are accepted`,
      `${e} is not verified on the contract`, `verify ${e} as admin_a (Staff).`);
  }
  for (const [dep, unit] of [["dep_a_haematology", "Haematology queue"], ["dep_a_radiology", "Radiology queue"]] as const) {
    const queue = await db.select().from(t.labRequests).where(eq(t.labRequests.departmentId, dep));
    note(`${unit}:`);
    for (const q of queue.sort((a, b) => a.code.localeCompare(b.code))) {
      const live = q.status === "PENDING" && q.expiresAt.getTime() > Date.now() && (await isTokenValidOnChain(q.childTokenHash));
      const state = q.status === "FULFILLED" ? "fulfilled" : live ? `open until ${when(q.expiresAt)}` : `expired ${when(q.expiresAt)}`;
      note(`  ${q.code} ${q.investigation.padEnd(40)} ${state}${q.id === "lrq_0004" ? "  (meant to be refused)" : ""}`);
    }
  }

  // ---- 6. Nursing
  console.log("\n6. Nursing: nurse_ojo sees admitted patients and records vital signs");
  check(await isVerifiedOnChain(wallet("nurse_ojo"), "hosp_a"), "nurse_ojo is verified at Oke-Ado on the contract, so vital signs can be saved",
    "nurse_ojo is not verified on the contract", "verify nurse_ojo as admin_a (Staff).");
  const ward = await db.select({ name: t.users.name, bed: t.admissions.bed }).from(t.admissions)
    .innerJoin(t.patients, eq(t.patients.id, t.admissions.patientId)).innerJoin(t.users, eq(t.users.id, t.patients.userId))
    .where(and(eq(t.admissions.departmentId, "dep_a_medical_ward"), eq(t.admissions.status, "ADMITTED")));
  check(ward.length >= 3, `${ward.length} patients on the Medical Ward: ${ward.map((w) => `${w.name} (bed ${w.bed})`).join(", ")}`,
    `only ${ward.length} patients are on the Medical Ward`, "admit a patient as dr_okafor (New entry, Admit).");

  // ---- 7. Administration
  console.log("\n7. Administration: admin_a verifies Dr Umeh; registrar approves Lakeside, refuses Riverbend");
  const [umeh] = await db.select().from(t.staffAffiliations).where(eq(t.staffAffiliations.id, "aff_0009"));
  check(umeh?.status === "PENDING_VERIFICATION", "Dr Umeh is waiting for verification", `Dr Umeh is already ${umeh?.status}`, "verify another new practitioner: admin_a, Staff, Add staff.");
  const [hospA] = await db.select().from(t.hospitals).where(eq(t.hospitals.id, "hosp_a"));
  const onChain = await read<readonly [string, boolean, boolean]>("hospitals", [idHash("hosp_a")]);
  check(onChain[0].toLowerCase() === wallet("admin_a").toLowerCase() && hospA?.adminWallet === wallet("admin_a"), "admin_a's wallet administers Oke-Ado on the contract",
    "admin_a's wallet does not administer Oke-Ado on the contract", "the seed did not finish; reseed.");
  const apps = await db.select().from(t.hospitalApplications).where(inArray(t.hospitalApplications.id, ["app_0009", "app_0010"]));
  for (const a of apps.sort((x, y) => x.id.localeCompare(y.id))) {
    check(a.status === "AWAITING_REVIEW", `${a.name} is waiting for the registrar`, `${a.name} is already ${a.status}`,
      "a decided application cannot be reopened. Submit a new one at /register-hospital before the presentation.");
  }
  const registrar = await read<string>("registrar", []);
  check(registrar.toLowerCase() === wallet("registrar").toLowerCase(), "the registrar account is the contract's registrar", "the registrar account is not the contract's registrar", "check WALLET_MNEMONIC.");

  console.log(problems ? `\n${problems} problem(s) found.` : "\nEverything is ready for the demonstration.");
  await getDbHandle().close();
}

main()
  .then(() => finish(0))
  .catch((e) => {
    console.error("\nThe check could not finish:", reason(e));
    finish(1);
  });
