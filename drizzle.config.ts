import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations from src/db/schema.ts (`pnpm db:generate`).
// Migrations are applied by scripts/migrate.ts, which works for both Neon and the embedded local database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
