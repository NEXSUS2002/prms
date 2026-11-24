// Prints the addresses derived from WALLET_MNEMONIC, so you know which wallet to fund before deploying.
import { formatEther } from "viem";
import { accountAt, chain, REGISTRAR_INDEX, RELAYER_INDEX, rpcLabel } from "~/server/chain.server";
import { getEnv } from "~/server/env.server";
import { finish } from "./finish";

async function main() {
  const env = getEnv();
  const { publicClient } = chain();
  console.log(`Network: ${env.chain} via ${rpcLabel(env.rpcUrl)}\n`);
  for (const [label, index] of [["Account 0: registrar and deployer (fund this one)", REGISTRAR_INDEX], ["Account 1: server relayer (funded automatically on deploy)", RELAYER_INDEX]] as const) {
    const address = accountAt(index).address;
    let balance = "unknown (network not reachable)";
    try {
      balance = formatEther(await publicClient.getBalance({ address })) + " ETH";
    } catch {
      /* offline */
    }
    console.log(`${label}\n  ${address}   balance: ${balance}\n`);
  }
}
main().then(() => finish(0));
