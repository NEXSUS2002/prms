import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { getEnv } from "~/server/env.server";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

type Handle = { db: DB; migrate: () => Promise<void>; close: () => Promise<void>; kind: "neon" | "embedded" | "memory" };

const MIGRATIONS = resolve(process.cwd(), "drizzle");

/** Network failures while a connection is being opened. No query has been sent yet, so trying again is safe. */
const CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EPIPE"]);
function isConnectFailure(e: unknown) {
  const err = e as { code?: string; message?: string };
  return CONNECT_ERROR_CODES.has(err?.code ?? "") || /Connection terminated unexpectedly|timeout expired/i.test(err?.message ?? "");
}

type ConnectCallback = (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: any) => void) => void;

/**
 * A pg pool that tries again when opening a connection fails because of the network (for example a DNS lookup
 * that fails for a moment), after 1, 2, 4, 8, 16 and 32 seconds. Only opening is retried: a connection that drops
 * in the middle of a query still fails, because the server may already have carried out that query.
 * Pool.query() opens its connection through this.connect(), so every query and transaction goes through here.
 */
class PatientPool extends pg.Pool {
  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    const attempt = async (): Promise<pg.PoolClient> => {
      for (let i = 0; ; i++) {
        try {
          return await super.connect();
        } catch (e) {
          if (i >= 6 || !isConnectFailure(e)) throw e;
          const why = (e as { code?: string }).code ?? (e as Error).message;
          console.warn(`Database connection failed (${why}); trying again in ${2 ** i} s ...`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    };
    if (!callback) return attempt();
    attempt().then(
      (client) => callback(undefined, client, (release) => client.release(release)),
      (err: Error) => callback(err, undefined, () => {}),
    );
  }
}

function open(): Handle {
  const url = process.env.PRMS_TEST_DB === "memory" ? "memory" : getEnv().databaseUrl;
  if (url && url !== "memory") {
    // Neon (or any PostgreSQL server). The pooled Neon connection string works with the standard pg driver.
    // idleTimeoutMillis: keep a connection open for a minute, so the seed (which waits about 12 seconds for each
    // Sepolia block between writes) reuses one connection instead of opening a new one, with a new DNS lookup,
    // for nearly every write.
    // min: on a computer far from the database (Nigeria to Neon in the USA), opening a connection takes about
    // 1.5 seconds, so the first screen after a pause was slow. Two connections are kept open for good. Not on
    // Vercel: there the app runs next to the database, opening is quick, and a connection kept through a paused
    // serverless function can be found dead when it wakes.
    const pool = new PatientPool({ connectionString: url, max: 5, min: process.env.VERCEL ? 0 : 2, idleTimeoutMillis: 60_000 });
    // A kept-open connection can drop while idle. pg reports that as an 'error' event, which would crash the
    // process if nothing listened. The pool has already discarded that connection and opens a new one when needed.
    pool.on("error", (e) => console.warn("An idle database connection was closed:", e.message));
    const db = drizzlePg(pool, { schema });
    return { db, kind: "neon", migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS }), close: () => pool.end() };
  }
  // No DATABASE_URL: an embedded PostgreSQL (PGlite) kept in .data/pglite, so the project runs with no account.
  let client: PGlite;
  if (url === "memory") client = new PGlite();
  else {
    const dir = resolve(process.cwd(), ".data", "pglite");
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const lite = drizzlePglite(client, { schema });
  return {
    db: lite as unknown as DB,
    kind: url === "memory" ? "memory" : "embedded",
    migrate: () => migratePglite(lite, { migrationsFolder: MIGRATIONS }),
    close: () => client.close(),
  };
}

const g = globalThis as unknown as { __prmsDb?: Handle };

export function getDbHandle(): Handle {
  if (!g.__prmsDb) g.__prmsDb = open();
  return g.__prmsDb;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDbHandle().db as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };
