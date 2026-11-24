import { redirect } from "@tanstack/react-router";
import type { Session } from "~/components/session";
import { homeFor } from "./format";

/** Where a signed-in user should be: the wallet step first, then the interface of his or her role. */
export function landingFor(session: Session): string | null {
  const me = session.me;
  if (!me) return null;
  if (me.user.role === "patient" && !me.patientId) return "/register";
  if (!me.user.wallet) return "/wallet";
  return homeFor[me.user.role] ?? "/";
}

/** Used by each role's layout route. The same rule is enforced again on the server for every call. */
export function requireRole(session: Session, role: string) {
  const me = session.me;
  if (!me) throw redirect({ href: "/" });
  const landing = landingFor(session)!;
  if (me.user.role !== role || landing !== homeFor[role]) throw redirect({ href: landing });
}
