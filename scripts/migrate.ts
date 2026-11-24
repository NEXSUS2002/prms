import { getDbHandle } from "~/db/index.server";
import { finish } from "./finish";

const handle = getDbHandle();
handle
  .migrate()
  .then(async () => {
    console.log(`Database schema is up to date (${handle.kind === "neon" ? "PostgreSQL at DATABASE_URL" : "embedded database in .data/pglite"}).`);
    await handle.close();
    finish(0);
  })
  .catch((e) => {
    console.error("Migration failed:", e.message);
    finish(1);
  });
