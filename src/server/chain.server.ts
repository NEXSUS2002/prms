import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  stringToBytes,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";
import { prmsAbi } from "~/chain/abi";
import { getEnv } from "./env.server";
import { AppError, badRequest } from "./util.server";

/** Off-chain ids (hospital, record, department) are put on the chain as keccak256 of the id text. */
export const idHash = (id: string): Hex => keccak256(stringToBytes(id));
export const hexHash = (sha256hex: string): Hex => ("0x" + sha256hex.replace(/^0x/, "")) as Hex;

export const REGISTRAR_INDEX = 0;
export const RELAYER_INDEX = 1;
export const FIRST_USER_INDEX = 2;

export function accountAt(index: number) {
  return mnemonicToAccount(getEnv().mnemonic, { addressIndex: index });
}

/**
 * The HTTP connection to the blockchain node, shared by the app, the deploy script and the seed script.
 * Seeding Sepolia sends hundreds of requests over about 25 minutes. viem's default (3 retries within about one
 * second) lets a short internet drop end the whole run, so failed requests are retried after 1, 2, 4, 8, 16 and
 * 32 seconds (about a minute in all), or after the delay the node asks for in a Retry-After header.
 */
export function rpcTransport() {
  return http(getEnv().rpcUrl, { timeout: 30_000, retryCount: 6, retryDelay: 1_000 });
}

/** The RPC address without its path, so an API key (Alchemy, Infura) never appears in logs or screenshots. */
export function rpcLabel(url = getEnv().rpcUrl) {
  try {
    const u = new URL(url);
    return u.pathname.length > 1 ? `${u.protocol}//${u.host}/…` : `${u.protocol}//${u.host}`;
  } catch {
    return "(RPC_URL is not a valid address)";
  }
}

function clients() {
  const env = getEnv();
  const chain = env.chain === "sepolia" ? sepolia : hardhat;
  const transport = rpcTransport();
  // How often to ask "is my transaction in a block yet?". Sepolia makes a block every 12 seconds; asking every
  // second (rather than every 3) shows a confirmation up to 2 seconds sooner, for a handful of extra cheap requests.
  const publicClient = createPublicClient({ chain, transport, pollingInterval: env.chain === "local" ? 250 : 1000 });
  const relayer = createWalletClient({ chain, transport, account: accountAt(RELAYER_INDEX) });
  return { env, chain, publicClient, relayer };
}

const g = globalThis as unknown as { __prmsChain?: ReturnType<typeof clients>; __prmsRelayerQueue?: Promise<unknown> };
export function chain() {
  if (!g.__prmsChain) g.__prmsChain = clients();
  return g.__prmsChain;
}
export function resetChainClients() {
  g.__prmsChain = undefined;
}

export function contractAddress(): `0x${string}` {
  const a = chain().env.contractAddress;
  if (!a) throw new AppError(500, "The smart contract has not been deployed. Run `pnpm contract:deploy` first.");
  return a;
}

export function publicChainConfig() {
  const env = getEnv();
  return {
    chain: env.chain,
    chainId: env.chainId,
    chainName: env.chain === "sepolia" ? "Sepolia" : "Hardhat (local)",
    rpcUrl: env.chain === "sepolia" ? "https://ethereum-sepolia-rpc.publicnode.com" : env.rpcUrl,
    explorer: env.chain === "sepolia" ? "https://sepolia.etherscan.io" : "",
    contractAddress: env.contractAddress,
  };
}

// ---------------------------------------------------------------- reads
export async function read<T = unknown>(functionName: string, args: unknown[]): Promise<T> {
  const { publicClient } = chain();
  return (await publicClient.readContract({
    address: contractAddress(),
    abi: prmsAbi,
    functionName: functionName as never,
    args: args as never,
  })) as T;
}

export const hasAccessOnChain = (patient: string, practitioner: string) =>
  read<boolean>("hasAccess", [patient, practitioner]);
export const isVerifiedOnChain = (practitioner: string, hospitalId: string) =>
  read<boolean>("isVerifiedAt", [practitioner, idHash(hospitalId)]);
export const isTokenValidOnChain = (tokenHashHex: string) => read<boolean>("isTokenValid", [hexHash(tokenHashHex)]);

// ---------------------------------------------------------------- relayer writes (one at a time, so nonces never collide)
export async function relay(functionName: string, args: unknown[]): Promise<Hex> {
  const run = async () => {
    const { publicClient, relayer } = chain();
    try {
      const hash = await relayer.writeContract({
        address: contractAddress(),
        abi: prmsAbi,
        functionName: functionName as never,
        args: args as never,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new AppError(502, "The ledger rejected the transaction.");
      return hash;
    } catch (e) {
      if (e instanceof AppError) throw e;
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      throw new AppError(502, "Ledger error: " + msg);
    }
  };
  const next = (g.__prmsRelayerQueue ?? Promise.resolve()).then(run, run);
  g.__prmsRelayerQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------- checking a transaction that a user signed in MetaMask
type EventName =
  | "HospitalRegistered"
  | "HospitalStatusChanged"
  | "PractitionerVerified"
  | "PractitionerSuspended"
  | "AccessGranted"
  | "AccessRevoked"
  | "EmergencyAccessLogged";

/**
 * Waits for the transaction, checks that it succeeded on our contract and returns the arguments of the
 * expected event. The server never trusts the browser's word that something was signed.
 */
export async function expectEvent(txHash: string, eventName: EventName, from?: string | null) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw badRequest("That is not a transaction hash.");
  const { publicClient } = chain();
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 180_000 });
  } catch {
    throw new AppError(504, "The transaction was not confirmed in time. Check it in your wallet and try again.");
  }
  if (receipt.status !== "success") throw badRequest("The transaction failed on the ledger.");
  if (receipt.to?.toLowerCase() !== contractAddress().toLowerCase()) throw badRequest("That transaction was not sent to the PRMS contract.");
  if (from && receipt.from.toLowerCase() !== from.toLowerCase()) throw badRequest("That transaction was signed by a different wallet.");
  const logs = parseEventLogs({ abi: prmsAbi, logs: receipt.logs, eventName: eventName as never }) as unknown as Array<{
    args: Record<string, unknown>;
  }>;
  if (!logs.length) throw badRequest(`The transaction did not record ${eventName}.`);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return { args: logs[0].args, from: receipt.from.toLowerCase(), blockTime: new Date(Number(block.timestamp) * 1000) };
}

/**
 * Used by the audit log: confirm that a stored transaction hash really carries the event it claims.
 * A confirmed transaction never changes, so a "yes" is remembered and that transaction is not fetched again.
 * A "no" is not remembered: it may only mean the network could not be reached this time.
 */
const confirmedEvents = new Set<string>();
export async function eventExists(txHash: string | null, eventName: EventName | "RecordAnchored" | "AddendumAnchored"): Promise<boolean> {
  if (!txHash) return false;
  const key = `${contractAddress()}:${txHash.toLowerCase()}:${eventName}`;
  if (confirmedEvents.has(key)) return true;
  try {
    const receipt = await chain().publicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== contractAddress().toLowerCase()) return false;
    const found = parseEventLogs({ abi: prmsAbi, logs: receipt.logs, eventName: eventName as never }).length > 0;
    if (found) confirmedEvents.add(key);
    return found;
  } catch {
    return false;
  }
}
