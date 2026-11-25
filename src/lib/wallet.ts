// MetaMask in the browser: connect, switch to the right network, sign and send contract calls.
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http, stringToHex, type Hex } from "viem";
import { prmsAbi } from "~/chain/abi";

export type ChainConfig = { chain: string; chainId: number; chainName: string; rpcUrl: string; explorer: string; contractAddress: string };

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function provider(): Eip1193 {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) {
    throw new Error(
      isMobileBrowser()
        ? 'This phone browser cannot reach MetaMask. Tap "Open in MetaMask" at the top of the page and continue in the MetaMask app.'
        : "MetaMask was not found. Install the MetaMask extension, then reload this page.",
    );
  }
  return eth;
}

export const hasWallet = () => typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);

/** True on a phone or tablet, where MetaMask is an app rather than a browser extension. */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS presents itself as a Mac; its touch screen gives it away.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * A link that opens this page inside the MetaMask app's own browser. MetaMask provides the wallet to pages there
 * just as the extension does on a computer, so PRMS works unchanged. Without the app, MetaMask's page offers to install it.
 * Format from MetaMask's documentation: https://link.metamask.io/dapp/{address without https://}.
 */
export function metaMaskAppLink(): string {
  if (typeof window === "undefined") return "https://link.metamask.io/";
  return `https://link.metamask.io/dapp/${window.location.host}${window.location.pathname}`;
}

const viemChain = (cfg: ChainConfig) =>
  defineChain({ id: cfg.chainId, name: cfg.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });

export async function ensureChain(cfg: ChainConfig) {
  const eth = provider();
  const hexId = "0x" + cfg.chainId.toString(16);
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    // 4902: MetaMask does not know this network yet, so add it.
    if ((e as { code?: number }).code !== 4902) throw new Error(`Switch MetaMask to the ${cfg.chainName} network to continue.`);
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hexId, chainName: cfg.chainName, rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: cfg.explorer ? [cfg.explorer] : undefined }],
    });
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The accounts MetaMask lets this site use, most recently selected first.
 * MetaMask shares only the accounts that were ticked when the site was connected. An account imported or
 * selected later is not shared until the user adds it, however it is selected inside MetaMask.
 */
async function sharedAccounts(ask: boolean): Promise<string[]> {
  const accounts = (await provider().request({ method: ask ? "eth_requestAccounts" : "eth_accounts" })) as string[];
  return (accounts ?? []).map((a) => a.toLowerCase());
}

/**
 * Connects MetaMask and puts it on the right network. When the signed-in user has a bound wallet that MetaMask
 * has not shared with this site, MetaMask's account picker is opened so the user can tick it. Returns the
 * bound wallet when it is shared, otherwise the account MetaMask selected.
 */
export async function connectWallet(cfg: ChainConfig, boundWallet?: string | null): Promise<string> {
  const bound = boundWallet?.toLowerCase() ?? null;
  let accounts = await sharedAccounts(true);
  if (bound && !accounts.includes(bound)) {
    try {
      // Re-opens the "choose accounts" window even for a site that is already connected.
      await provider().request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      accounts = await sharedAccounts(false);
    } catch (e) {
      if ((e as { code?: number }).code === 4001) throw new Error("You closed MetaMask without choosing an account.");
      // A wallet without wallet_requestPermissions: the message from activeAccount() explains what to do.
    }
  }
  if (!accounts.length) throw new Error("No account was selected in MetaMask.");
  await ensureChain(cfg);
  return bound && accounts.includes(bound) ? bound : accounts[0];
}

/** Makes sure MetaMask is on the right network and can sign with the wallet bound to the signed-in account. */
async function activeAccount(cfg: ChainConfig, boundWallet: string | null): Promise<Hex> {
  const account = await connectWallet(cfg, boundWallet);
  if (boundWallet && account !== boundWallet.toLowerCase()) {
    throw new Error(
      `MetaMask has not shared ${short(boundWallet)}, the wallet bound to this PRMS account. In MetaMask, open the account list, ` +
        `select that account (import it first if it is not there) and connect it to this site. Then try again.`,
    );
  }
  return account as Hex;
}

function explain(e: unknown): Error {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number; reason?: string; shortMessage?: string } };
  if (err.code === 4001 || err.cause?.code === 4001 || /User rejected|denied/i.test(err.message ?? "")) return new Error("You cancelled the request in MetaMask. Nothing was changed.");
  const reason = err.cause?.reason ?? /reverted with reason string '([^']+)'/.exec(err.message ?? "")?.[1];
  if (reason) return new Error(`The ledger refused: ${reason}.`);
  if (/insufficient funds/i.test(err.message ?? "")) return new Error("This wallet has no test ETH to pay for the transaction.");
  return new Error(err.shortMessage ?? err.message ?? "The wallet request failed.");
}

/** Signs and sends one call to the PRMS contract from the user's wallet, and returns the transaction hash. */
export async function sendContractTx(cfg: ChainConfig, boundWallet: string | null, functionName: string, args: unknown[]): Promise<string> {
  if (!cfg.contractAddress) throw new Error("The smart contract has not been deployed yet. Run `pnpm contract:deploy`.");
  const account = await activeAccount(cfg, boundWallet);
  const chain = viemChain(cfg);
  const wallet = createWalletClient({ chain, transport: custom(provider()), account });
  const reader = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  try {
    // Simulate first, so a call the contract would reject is explained before MetaMask opens.
    await reader.simulateContract({ address: cfg.contractAddress as Hex, abi: prmsAbi, functionName: functionName as never, args: args as never, account });
    return await wallet.writeContract({ address: cfg.contractAddress as Hex, abi: prmsAbi, functionName: functionName as never, args: args as never });
  } catch (e) {
    throw explain(e);
  }
}

export async function signBinding(cfg: ChainConfig, boundWallet: string | null, message: string): Promise<{ address: string; signature: string }> {
  const account = await activeAccount(cfg, boundWallet);
  try {
    const signature = (await provider().request({ method: "personal_sign", params: [stringToHex(message), account] })) as string;
    return { address: account, signature };
  } catch (e) {
    throw explain(e);
  }
}

type WalletState = {
  /** the account MetaMask has selected, if it is shared with this site */
  account: string | null;
  /** every account MetaMask shares with this site; PRMS can sign with any of them */
  accounts: string[];
  chainId: number | null;
  installed: boolean;
  /** a phone or tablet: without MetaMask here, the way in is the MetaMask app's browser */
  mobile: boolean;
};

/** The accounts and network MetaMask offers this site right now, kept up to date. */
export function useWallet() {
  // `mobile` starts false and is set after the first render, so the page the server sends matches the first render here.
  const [state, setState] = useState<WalletState>({ account: null, accounts: [], chainId: null, installed: false, mobile: false });
  useEffect(() => {
    const mobile = isMobileBrowser();
    if (!hasWallet()) {
      setState((s) => ({ ...s, mobile }));
      return;
    }
    const eth = provider();
    let live = true;
    const refresh = async () => {
      try {
        const accounts = await sharedAccounts(false);
        const chainId = parseInt((await eth.request({ method: "eth_chainId" })) as string, 16);
        if (live) setState({ account: accounts[0] ?? null, accounts, chainId, installed: true, mobile });
      } catch {
        if (live) setState({ account: null, accounts: [], chainId: null, installed: true, mobile });
      }
    };
    refresh();
    eth.on?.("accountsChanged", refresh);
    eth.on?.("chainChanged", refresh);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", refresh);
      eth.removeListener?.("chainChanged", refresh);
    };
  }, []);
  return state;
}
