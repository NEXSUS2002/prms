import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "~/db/index.server";
import * as schema from "~/db/schema";
import { getEnv } from "~/server/env.server";

const env = getEnv();

export const auth = betterAuth({
  secret: env.authSecret,
  baseURL: env.authUrl,
  trustedOrigins: [env.authUrl, "http://localhost:3000", "http://127.0.0.1:3000"],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.users, session: schema.sessions, account: schema.accounts, verification: schema.verifications },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  user: {
    additionalFields: {
      // input: false means a visitor cannot choose these at sign-up: everyone who registers is a patient.
      role: { type: "string", required: false, defaultValue: "patient", input: false },
      medicalLicenseNo: { type: "string", required: false, input: false },
      publicKey: { type: "string", required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    // Without this, every server call looks the session up in the database (one network round trip to Neon,
    // about 175 ms from Nigeria) before it does any work. With it, a signed cookie carries the session for up to
    // five minutes, and the database is asked again only after that. Signing out clears the cookie at once.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [tanstackStartCookies()],
});
