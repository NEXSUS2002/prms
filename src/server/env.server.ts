import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

export type ChainName = "local" | "sepolia";

const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

function readDeployment(chain: ChainName): { address: `0x${string}`; deployBlock: number } | null {
  const file = resolve(process.cwd(), "deployments", `${chain}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function getEnv() {
  const chain = (process.env.CHAIN === "sepolia" ? "sepolia" : "local") as ChainName;
  const deployment = readDeployment(chain);
  const contractAddress = (process.env.CONTRACT_ADDRESS || deployment?.address || "") as `0x${string}` | "";
  const mnemonic = (process.env.WALLET_MNEMONIC || DEFAULT_MNEMONIC).replace(/^"|"$/g, "").trim();
  if (chain === "sepolia" && mnemonic === DEFAULT_MNEMONIC) {
    throw new Error("WALLET_MNEMONIC is still the public Hardhat test phrase. Set your own phrase in .env before using Sepolia.");
  }
  return {
    chain,
    chainId: chain === "sepolia" ? 11155111 : 31337,
    rpcUrl: process.env.RPC_URL || (chain === "sepolia" ? "https://ethereum-sepolia-rpc.publicnode.com" : "http://127.0.0.1:8545"),
    contractAddress,
    deployBlock: deployment?.deployBlock ?? 0,
    mnemonic,
    databaseUrl: process.env.DATABASE_URL?.trim() || "",
    authSecret: process.env.BETTER_AUTH_SECRET || "prms-development-secret-change-me",
    authUrl: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    seedFundEth: process.env.SEED_FUND_ETH || "0.002",
  };
}
