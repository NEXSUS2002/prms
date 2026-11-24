// Patient self-registration and wallet binding.
import { eq } from "drizzle-orm";
import { verifyMessage } from "viem";
import { db } from "~/db/index.server";
import { patients, users } from "~/db/schema";
import { DIAGNOSES, DRUGS } from "~/lib/catalogue";
import { type Actor, requireRole } from "./actor.server";
import { publicChainConfig } from "./chain.server";
import { badRequest, isAddress, lower, newId, nextCode, sha256 } from "./util.server";

export const bindingMessage = (email: string) => `PRMS wallet binding\nAccount: ${email}\nI confirm that this wallet belongs to me.`;

export function describeActor(actor: Actor) {
  return {
    user: { id: actor.userId, name: actor.name, email: actor.email, role: actor.role, wallet: actor.wallet, licenseNo: actor.licenseNo },
    patientId: actor.patientId,
    affiliations: actor.affiliations,
    hospitalId: actor.hospitalId,
    working: actor.working,
    bindingMessage: bindingMessage(actor.email),
    chain: publicChainConfig(),
  };
}

export async function completePatientProfile(actor: Actor, input: { dateOfBirth: string; sex: string; bloodGroup?: string; genotype?: string }) {
  requireRole(actor, "patient");
  if (actor.patientId) return { patientId: actor.patientId };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth ?? "") || Number.isNaN(Date.parse(input.dateOfBirth))) throw badRequest("Enter your date of birth.");
  if (new Date(input.dateOfBirth).getTime() > Date.now()) throw badRequest("The date of birth cannot be in the future.");
  if (!["F", "M"].includes(input.sex)) throw badRequest("Choose your sex as recorded on your hospital card.");
  const id = newId("pat");
  const code = await nextCode("patient", "PT-");
  await db.insert(patients).values({
    id, userId: actor.userId, code, globalHealthHash: sha256(`PRMS|${id}|${actor.name}|${input.dateOfBirth}`),
    dateOfBirth: input.dateOfBirth, sex: input.sex, bloodGroup: input.bloodGroup || null, genotype: input.genotype || null,
  });
  return { patientId: id, code };
}

/** Binds a wallet to the account after checking a signature made with that wallet. */
export async function bindWallet(actor: Actor, input: { address: string; signature: string }) {
  if (!isAddress(input.address)) throw badRequest("That is not a wallet address.");
  const address = lower(input.address);
  if (actor.wallet && actor.wallet !== address) throw badRequest("Your account is already bound to a different wallet. Switch MetaMask to that account.");
  const valid = await verifyMessage({ address: input.address as `0x${string}`, message: bindingMessage(actor.email), signature: input.signature as `0x${string}` }).catch(() => false);
  if (!valid) throw badRequest("The signature does not match that wallet.");
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.publicKey, address));
  if (taken && taken.id !== actor.userId) throw badRequest("That wallet is already bound to another account.");
  await db.update(users).set({ publicKey: address, updatedAt: new Date() }).where(eq(users.id, actor.userId));
  return { wallet: address };
}

export const catalogues = () => ({ drugs: DRUGS, diagnoses: DIAGNOSES });
