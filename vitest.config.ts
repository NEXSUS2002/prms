import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Set explicitly so the tests never pick up values from .env (for example your Sepolia wallet phrase).
    env: {
      PRMS_TEST_DB: "memory",
      CHAIN: "local",
      RPC_URL: "http://127.0.0.1:8546",
      CONTRACT_ADDRESS: "",
      BETTER_AUTH_SECRET: "test-secret",
      WALLET_MNEMONIC: "test test test test test test test test test test test junk",
    },
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
