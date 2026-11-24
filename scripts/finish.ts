/**
 * Ends a command-line script with the given exit code.
 *
 * Why not process.exit()? On Windows with Node 24, calling process.exit() straight after talking to the
 * blockchain can crash Node itself while it closes the network connection:
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
 * The script's work is already done when this happens, but the crash turns success into failure and stops
 * `pnpm bootstrap` half-way. Setting process.exitCode lets Node close everything in order and exit by itself.
 *
 * The timer is a safety net: if something unexpected keeps the process alive, it is stopped after 15 seconds.
 * unref() means the timer itself never keeps the process alive.
 */
export function finish(code: 0 | 1) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 15_000).unref();
}

type ErrorLike = { shortMessage?: string; message?: string; status?: number; details?: string; code?: unknown; walk?: (fn?: (e: unknown) => boolean) => unknown };

/**
 * One line explaining why a blockchain or database call failed: the summary, the HTTP status and the network
 * error code (for example ECONNRESET or UND_ERR_CONNECT_TIMEOUT). viem's full error text is not printed because
 * it contains the RPC URL, and with Alchemy or Infura that URL contains the API key.
 */
export function reason(e: unknown): string {
  const top = e as ErrorLike;
  const httpError = (top.walk?.((x) => typeof (x as ErrorLike)?.status === "number") ?? null) as ErrorLike | null;
  const parts = [top.shortMessage ?? top.message ?? String(e)];
  if (httpError?.status) parts.push(`HTTP status ${httpError.status}`);
  const details = (httpError ?? top).details;
  if (details && !parts.includes(details)) parts.push(details);
  parts.push(...networkCodes(e));
  return parts.join(" | ");
}

/** Node's network error codes anywhere in the cause chain, including inside an AggregateError (IPv4 and IPv6 tries). */
function networkCodes(e: unknown, depth = 0): string[] {
  if (!e || typeof e !== "object" || depth > 8) return [];
  const x = e as { code?: unknown; cause?: unknown; errors?: unknown[] };
  const own = typeof x.code === "string" ? [x.code] : [];
  const inner = [...(x.errors ?? []), x.cause].flatMap((c) => networkCodes(c, depth + 1));
  return [...new Set([...own, ...inner])];
}
