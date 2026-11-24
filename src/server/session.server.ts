import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { auth } from "~/lib/auth.server";
import { type Actor, loadActor } from "./actor.server";
import { AppError } from "./util.server";

const HOSPITAL_COOKIE = "prms_working_hospital";

export async function sessionUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: getRequest().headers });
  return session?.user.id ?? null;
}

/** The signed-in user, with the hospital he or she chose to work at (FR12). */
export async function currentActor(): Promise<Actor> {
  const userId = await sessionUserId();
  if (!userId) throw new AppError(401, "Please sign in.");
  return loadActor(userId, getCookie(HOSPITAL_COOKIE) ?? null);
}

export function rememberWorkingHospital(hospitalId: string) {
  setCookie(HOSPITAL_COOKIE, hospitalId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Runs a service call for the signed-in user and turns any failure into a plain result the browser can show. */
export async function run<T>(fn: (actor: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn(await currentActor()) };
  } catch (e) {
    return fail(e);
  }
}

/** For the few calls that need no session (sign-in page, hospital application). */
export async function runPublic<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return fail(e);
  }
}

function fail(e: unknown): { ok: false; status: number; message: string } {
  if (e instanceof AppError) return { ok: false, status: e.status, message: e.message };
  console.error(e);
  return { ok: false, status: 500, message: "Something went wrong on the server. Please try again." };
}
