import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db/index.server";
import { counters } from "~/db/schema";
import { getEnv } from "./env.server";

/** An error whose message is safe to show to the user. `status` mirrors the HTTP status the API would return. */
export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AppError";
  }
}
export const forbidden = (m = "You are not allowed to do this.") => new AppError(403, m);
export const notFound = (m = "Not found.") => new AppError(404, m);
export const badRequest = (m: string) => new AppError(400, m);

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** JSON with object keys sorted, so the same record always produces the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** Next value of a named counter, formatted, e.g. nextCode("patient", "PT-") -> "PT-0011". */
export async function nextCode(name: string, prefix: string, width = 4): Promise<string> {
  const rows = await db
    .insert(counters)
    .values({ name, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return prefix + String(rows[0].value).padStart(width, "0");
}

export async function setCounterAtLeast(name: string, value: number) {
  const cur = await db.select().from(counters).where(eq(counters.name, name));
  if (!cur.length) await db.insert(counters).values({ name, value });
  else if (cur[0].value < value) await db.update(counters).set({ value }).where(eq(counters.name, name));
}

// ---- Laboratory results are stored encrypted. The key is derived from the server secret and the
// ---- ordering physician's id, so a result can be opened only through that physician's (or the patient's) session.
// ---- `secret` is given only by scripts/rotate-secret.ts, which re-encrypts stored results with a new secret.
function keyFor(physicianId: string, secret = getEnv().authSecret): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "prms-lab-result", physicianId, 32));
}

export function encryptFor(physicianId: string, plaintext: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(physicianId, secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptFor(physicianId: string, payload: string, secret?: string): string {
  const [iv, tag, body] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", keyFor(physicianId, secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export const isAddress = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
export const lower = (a: string) => a.toLowerCase();
