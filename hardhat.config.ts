// Hardhat is used only as the local development blockchain (`pnpm chain`).
// The contract is compiled by scripts/compile-contract.ts and deployed by scripts/deploy-contract.ts.
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  networks: {
    node: {
      type: "edr-simulated",
      chainId: 31337,
      accounts: {
        // The well-known Hardhat test mnemonic. These keys are public: never send real funds to them.
        mnemonic: "test test test test test test test test test test test junk",
        count: 60,
        accountsBalance: "10000000000000000000000",
      },
    },
  },
};

export default config;
