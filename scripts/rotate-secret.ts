// Replaces BETTER_AUTH_SECRET with a new random value:  pnpm secret:rotate
//
// The secret does two jobs. It signs sign-in cookies, so it must be secret: the placeholder from .env.example is
// public, and anyone who knows it could forge a sign-in. And laboratory results are encrypted with keys derived
// from it, so results saved under the old secret could no longer be opened under a new one. This script
// therefore re-encrypts every stored result with the new secret (all in one transaction, so it is all or
// nothing) and then writes the new secret into .env and .env.sepolia. Put the same value in Vercel.
// Everyone has to sign in again afterwards. The secret is written to the files only, never printed.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, getDbHandle } from "~/db/index.server";
import { labRequests, labResults } from "~/db/schema";
import { getEnv } from "~/server/env.server";
import { decryptFor, encryptFor } from "~/server/util.server";
import { finish, reason } from "./finish";

/** True when something answers on localhost:port, for example a running  pnpm dev. */
const listening = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
  });

const valueOf = (text: string, name: string) =>
  text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "") ?? "";

async function main() {
  const env = getEnv();
  // A dev server still running with the old secret would encrypt new results with it. Its port is the one in BETTER_AUTH_URL.
  const url = new URL(env.authUrl);
  if (["localhost", "127.0.0.1"].includes(url.hostname) && (await listening(Number(url.port || 80)))) {
    throw new Error(`pnpm dev is running on ${url.host}. Stop it first (Ctrl+C in its terminal): it still uses the old secret.`);
  }
  const oldSecret = env.authSecret;
  const newSecret = randomBytes(32).toString("base64url"); // 43 letters, digits, - and _: safe in .env and in Vercel
  console.log(`Database: ${getDbHandle().kind === "neon" ? "PostgreSQL at DATABASE_URL" : "embedded database in .data/pglite"}`);

  // ---- re-encrypt every laboratory result. Nothing is written unless all of them open with the old secret.
  const rows = await db
    .select({ id: labResults.id, payload: labResults.resultPayload, physicianId: labRequests.orderingPhysicianId })
    .from(labResults)
    .innerJoin(labRequests, eq(labRequests.id, labResults.requestId));
  const updates = rows.map((r) => {
    let plaintext: string;
    try {
      plaintext = decryptFor(r.physicianId, r.payload, oldSecret);
    } catch {
      throw new Error(`Result ${r.id} does not open with the BETTER_AUTH_SECRET in .env, so nothing was changed.`);
    }
    const payload = encryptFor(r.physicianId, plaintext, newSecret);
    if (decryptFor(r.physicianId, payload, newSecret) !== plaintext) throw new Error(`Re-encrypting result ${r.id} failed; nothing was changed.`);
    return { id: r.id, payload };
  });
  await db.transaction(async (tx) => {
    for (const u of updates) await tx.update(labResults).set({ resultPayload: u.payload }).where(eq(labResults.id, u.id));
  });
  console.log(`Re-encrypted ${updates.length} laboratory result(s) with the new secret.`);

  // ---- write the new secret into the profiles that use this same database and the old secret
  const changed: string[] = [];
  try {
    for (const name of [".env", ".env.sepolia"]) {
      const file = resolve(process.cwd(), name);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      if (valueOf(text, "BETTER_AUTH_SECRET") !== oldSecret || valueOf(text, "DATABASE_URL") !== env.databaseUrl) continue;
      writeFileSync(file, text.replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${newSecret}`));
      changed.push(name);
    }
  } catch (e) {
    // The results now need the new secret, so it must not be lost.
    console.error(`Could not write the new secret to the .env files (${(e as Error).message}).`);
    console.error(`Set this line in .env and .env.sepolia yourself:\nBETTER_AUTH_SECRET=${newSecret}`);
    throw e;
  }
  console.log(`New BETTER_AUTH_SECRET written to: ${changed.join(", ") || "(no file matched)"}`);
  console.log("Copy it from .env into Vercel (Settings, Environment Variables). Everyone must sign in again.");
  await getDbHandle().close();
}

main()
  .then(() => finish(0))
  .catch((e) => {
    console.error("\nThe rotation stopped:", reason(e));
    finish(1);
  });
