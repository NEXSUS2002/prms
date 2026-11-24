import { deployContract } from "~/server/deploy.server";
import { finish, reason } from "./finish";

deployContract()
  .then((d) => {
    console.log(`Saved to deployments. The app will use ${d.address} automatically.`);
    finish(0);
  })
  .catch((e) => {
    console.error("\nDeployment failed:", reason(e));
    if (String(e.message).includes("fetch failed") || String(e.message).includes("ECONNREFUSED")) {
      console.error("The blockchain could not be reached. For CHAIN=local, start it in another terminal with:  pnpm chain");
    }
    finish(1);
  });
