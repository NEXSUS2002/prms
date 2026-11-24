import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, formatEther, parseEther } from "viem";
import artifact from "~/chain/PRMSRegistry.json";
import { prmsAbi } from "~/chain/abi";
import { accountAt, chain, REGISTRAR_INDEX, RELAYER_INDEX, resetChainClients, rpcLabel, rpcTransport } from "./chain.server";
import { getEnv } from "./env.server";

/** Deploys PRMSRegistry from account 0 (the registrar) and records the address in deployments/<chain>.json. */
export async function deployContract(log: (m: string) => void = console.log, save = true) {
  const env = getEnv();
  const { publicClient, chain: viemChain } = chain();
  const deployer = accountAt(REGISTRAR_INDEX);
  const relayer = accountAt(RELAYER_INDEX);
  const wallet = createWalletClient({ chain: viemChain, transport: rpcTransport(), account: deployer });

  const balance = await publicClient.getBalance({ address: deployer.address });
  log(`Network: ${env.chain} (chain id ${env.chainId}) via ${rpcLabel(env.rpcUrl)}`);
  log(`Deployer / registrar: ${deployer.address} (balance ${formatEther(balance)} ETH)`);
  if (balance === 0n) throw new Error(`The deployer wallet ${deployer.address} has no ETH on ${env.chain}. Fund it from a faucet first.`);

  const hash = await wallet.deployContract({ abi: prmsAbi, bytecode: artifact.bytecode as `0x${string}`, args: [relayer.address] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment failed.");
  log(`PRMSRegistry deployed at ${receipt.contractAddress} (block ${receipt.blockNumber})`);

  if (env.chain === "sepolia") {
    // The relayer pays the gas for record anchors and laboratory tokens, so it needs some test ETH of its own.
    const want = parseEther(process.env.RELAYER_FUND_ETH || "0.03");
    const have = await publicClient.getBalance({ address: relayer.address });
    if (have < want) {
      const tx = await wallet.sendTransaction({ to: relayer.address, value: want - have });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 300_000 });
      log(`Sent ${formatEther(want - have)} ETH to the relayer ${relayer.address}`);
    }
  }

  const out = { address: receipt.contractAddress, deployBlock: Number(receipt.blockNumber), deployer: deployer.address, relayer: relayer.address, deployedAt: new Date().toISOString() };
  if (save) {
    mkdirSync(resolve(process.cwd(), "deployments"), { recursive: true });
    writeFileSync(resolve(process.cwd(), "deployments", `${env.chain}.json`), JSON.stringify(out, null, 2) + "\n");
  } else {
    process.env.CONTRACT_ADDRESS = receipt.contractAddress; // tests: use the address without touching the saved deployment
  }
  resetChainClients(); // so the new address is picked up
  return out;
}
