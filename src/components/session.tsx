import { createContext, useContext } from "react";
import type { getMe } from "~/server/api.functions";

export type Session = Awaited<ReturnType<typeof getMe>>;
export type Me = NonNullable<Session["me"]>;

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("Session is not available.");
  return s;
}

/** For pages behind sign-in. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("Not signed in.");
  return me;
}
