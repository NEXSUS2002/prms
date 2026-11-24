import { getDbHandle } from "~/db/index.server";
import { seedAll } from "~/server/seed.server";
import { finish, reason } from "./finish";

async function main() {
  const handle = getDbHandle();
  await handle.migrate();
  const { wallets, password } = await seedAll();
  console.log("\nEvery account signs in with the password:", password);
  console.log("Wallet for each account (import the private key into MetaMask to act as that person):\n");
  for (const w of wallets.filter((x) => x.role !== "relayer").slice(0, 60)) {
    console.log(`  ${(w.email ?? "").padEnd(28)} ${w.role.padEnd(16)} ${w.address}`);
  }
  console.log("\nPrivate keys are in wallets.local.json (not committed to git).");
  await handle.close();
}

main()
  .then(() => finish(0))
  .catch((e) => {
    console.error("\nSeeding failed:", reason(e));
    console.error("If it stopped while funding wallets, run  pnpm seed  again: funded wallets are skipped.");
    console.error("If it stopped later, run  pnpm bootstrap  (a partly seeded contract cannot be seeded again).");
    finish(1);
  });
