// Renews the parts of the seed data that run out with time, so the demonstration works on the day you present.
//   - Consent lasts 24 hours on the contract. Each patient's wallet signs grantAccess again for the doctors the
//     seed gave access to (for example Adaeze -> Dr Bello, needed for steps 1 and 5 of the README demonstration).
//   - Emeka's waiting request from Dr Adebayo (step 2) is put back if a rehearsal answered it.
//   - Laboratory requisitions that were open when seeded get a new token with the same validity period.
//     (The GeneXpert requisition stays expired: it exists to be refused.)
// It does not undo one-time actions, such as a dispute, a staff verification or a hospital approval:
// what is written on a blockchain stays there. Run it within 24 hours before presenting:  pnpm demo:refresh
// It only adds to the data and is safe to run again. Nothing is renewed while more than 12 hours remain.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { createWalletClient, parseEther } from "viem";
import { prmsAbi } from "~/chain/abi";
import { db, getDbHandle } from "~/db/index.server";
import * as t from "~/db/schema";
import { accountAt, chain, contractAddress, expectEvent, hexHash, idHash, read, REGISTRAR_INDEX, relay, rpcLabel, rpcTransport } from "~/server/chain.server";
import { childTokenHash } from "~/server/lab.server";
import { newId } from "~/server/util.server";
import { finish, reason } from "./finish";

const KEEP_MS = 12 * 3600_000; // anything with more than 12 hours left is left alone
const load = (name: string): Record<string, any>[] => JSON.parse(readFileSync(resolve(process.cwd(), "seed", "data", name), "utf8"));
const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

async function main() {
  const { env, publicClient, chain: viemChain } = chain();
  // Consent ends by the time of the latest block (block.timestamp), so measure against that, not this computer.
  const chainNow = Number((await publicClient.getBlock()).timestamp) * 1000;
  console.log(`Chain ${env.chain} via ${rpcLabel()}, contract ${contractAddress()}, database: ${getDbHandle().kind}\n`);

  // Every seeded user's wallet comes from WALLET_MNEMONIC. Find each wallet's position so its key can sign.
  const indexOf = new Map<string, number>();
  for (let i = 0; i < 100; i++) indexOf.set(accountAt(i).address.toLowerCase(), i);
  const users = new Map((await db.select().from(t.users)).map((u) => [u.id, u]));
  const patients = new Map((await db.select().from(t.patients)).map((p) => [p.id, p]));
  const walletOf = (userId: string) => (users.get(userId)?.publicKey ?? "") as `0x${string}`;
  const walletClient = (index: number) => createWalletClient({ chain: viemChain, transport: rpcTransport(), account: accountAt(index) });

  // A patient's wallet needs a little test ETH to sign. Top it up from the registrar when it runs low.
  const perTx = (await publicClient.getGasPrice()) * 2n * 150_000n;
  const registrar = walletClient(REGISTRAR_INDEX);
  async function topUp(address: `0x${string}`) {
    if ((await publicClient.getBalance({ address })) >= perTx * 3n) return;
    const hash = await registrar.sendTransaction({ to: address, value: parseEther(env.seedFundEth) });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
    console.log(`   funded   ${address} with ${env.seedFundEth} ETH`);
  }

  // ---- consent
  console.log("Consent (signed again by each patient's wallet; lasts 24 hours)");
  for (const g of load("access_grants.json").filter((x) => x.status === "GRANTED")) {
    const patientUser = patients.get(g.patient_id)!.userId;
    const patient = walletOf(patientUser);
    const doctor = walletOf(g.practitioner_id);
    const label = `${users.get(patientUser)!.name} -> ${users.get(g.practitioner_id)!.name}`.padEnd(42);
    const until = new Date(Number(await read<bigint>("consentExpiry", [patient, doctor])) * 1000);
    if (until.getTime() > chainNow + KEEP_MS) {
      console.log(`   kept     ${label} open until ${when(until)}`);
      continue;
    }
    const index = indexOf.get(patient.toLowerCase());
    if (index === undefined) throw new Error(`${label.trim()}: the patient's wallet does not come from WALLET_MNEMONIC.`);
    await topUp(patient);
    const hash = await walletClient(index).writeContract({ address: contractAddress(), abi: prmsAbi, functionName: "grantAccess" as never, args: [doctor] as never });
    // The same check the app makes when a patient approves in MetaMask.
    const ev = await expectEvent(hash, "AccessGranted", patient);
    const expiresAt = new Date(Number(ev.args.expiresAt) * 1000);
    // The contract keeps one expiry per patient and doctor, so the new grant replaces any older one still marked active.
    const older = await db.select().from(t.accessGrants).where(and(
      eq(t.accessGrants.patientId, g.patient_id), eq(t.accessGrants.practitionerId, g.practitioner_id),
      eq(t.accessGrants.grantType, "CONSENT"), eq(t.accessGrants.status, "GRANTED"),
    ));
    for (const o of older) {
      const ended = o.expiresAt && o.expiresAt < ev.blockTime ? o.expiresAt : ev.blockTime;
      await db.update(t.accessGrants).set({ status: "EXPIRED", expiresAt: ended }).where(eq(t.accessGrants.id, o.id));
    }
    await db.insert(t.accessGrants).values({
      id: newId("acc"), patientId: g.patient_id, practitionerId: g.practitioner_id, hospitalId: g.hospital_id, grantType: "CONSENT",
      status: "GRANTED", requestedAt: ev.blockTime, decidedAt: ev.blockTime, expiresAt, txHash: hash,
    });
    console.log(`   renewed  ${label} open until ${when(expiresAt)}`);
  }

  // ---- waiting requests (step 2)
  console.log("\nRequests waiting for the patient");
  for (const g of load("access_grants.json").filter((x) => x.status === "PENDING")) {
    const label = `${users.get(g.practitioner_id)!.name} asks ${users.get(patients.get(g.patient_id)!.userId)!.name}`.padEnd(42);
    const open = await db.select().from(t.accessGrants).where(and(
      eq(t.accessGrants.patientId, g.patient_id), eq(t.accessGrants.practitionerId, g.practitioner_id), eq(t.accessGrants.status, "PENDING"),
    ));
    if (open.length) {
      console.log(`   kept     ${label} still waiting`);
      continue;
    }
    await db.insert(t.accessGrants).values({
      id: newId("acc"), patientId: g.patient_id, practitionerId: g.practitioner_id, hospitalId: g.hospital_id, grantType: "CONSENT",
      status: "PENDING", requestedAt: new Date(Date.now() - (g.requested_hours_before_seed ?? 0) * 3600_000),
    });
    console.log(`   restored ${label} waiting again`);
  }

  // ---- laboratory requisitions that were open when seeded
  console.log("\nLaboratory requisitions");
  for (const s of load("lab_requests.json").filter((x) => x.status === "PENDING" && x.expires_in_hours_from_seed > 0)) {
    const [q] = await db.select().from(t.labRequests).where(eq(t.labRequests.id, s.id));
    const label = `${q?.code ?? s.id} ${s.investigation}`.padEnd(52);
    if (!q || q.status !== "PENDING") {
      console.log(`   skipped  ${label} ${q ? "already has a result" : "not in the database"}`);
      continue;
    }
    if (q.expiresAt.getTime() > Date.now() + KEEP_MS) {
      console.log(`   kept     ${label} open until ${when(q.expiresAt)}`);
      continue;
    }
    // A token hash can be registered on the contract only once, so the requisition gets a new secret and hash.
    const secret = randomBytes(32).toString("hex");
    const hash = childTokenHash(q.parentRequisitionId, q.departmentId, secret);
    const expiresAt = new Date(Date.now() + s.expires_in_hours_from_seed * 3600_000);
    const txHash = await relay("registerToken", [hexHash(hash), idHash(q.departmentId), BigInt(Math.floor(expiresAt.getTime() / 1000))]);
    await db.update(t.labRequests).set({ tokenSecret: secret, childTokenHash: hash, expiresAt, txHash }).where(eq(t.labRequests.id, q.id));
    console.log(`   renewed  ${label} open until ${when(expiresAt)}`);
  }

  console.log("\nDone. Run  pnpm demo:check  to confirm everything is ready.");
  await getDbHandle().close();
}

main()
  .then(() => finish(0))
  .catch((e) => {
    console.error("\nThe refresh stopped:", reason(e));
    console.error("Run  pnpm demo:refresh  again: it continues where it stopped.");
    finish(1);
  });
