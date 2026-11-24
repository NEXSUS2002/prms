// Unwraps the { ok, data } results returned by the server functions.
export class CallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new CallError(res.status, res.message);
  return res.data;
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
