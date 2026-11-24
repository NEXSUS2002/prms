import { type ReactNode, useCallback, useState } from "react";
import { messageOf } from "~/lib/call";
import { shortHash } from "~/lib/format";
import { useSession } from "./session";

const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3",
  timeline: "M12 3v18M12 7h7M12 12h5M12 17h7M5 7h.01M5 12h.01M5 17h.01",
  key: "M15 7a4 4 0 1 1-3.9 5H7v3H4v-3H2v-2h9.1A4 4 0 0 1 15 7z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  users: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
  hospital: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3",
  bed: "M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  check: "M5 12l5 5 9-10",
  warn: "M12 3l10 18H2zM12 10v5M12 18h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
};

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.plus} />
    </svg>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "active" | "pending" | "danger" | "chain" | "muted"; children: ReactNode }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function Banner({ tone, children, icon }: { tone: "ok" | "warn" | "danger" | "chain"; children: ReactNode; icon?: string }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon ?? (tone === "ok" ? "check" : tone === "chain" ? "clock" : "warn")} />
      <div>{children}</div>
    </div>
  );
}

/** A transaction hash. On Sepolia it links to Etherscan. */
export function Hash({ value, label }: { value: string | null | undefined; label?: string }) {
  const { chain } = useSession();
  if (!value) return null;
  const text = `${label ? label + " " : ""}${shortHash(value)}`;
  if (chain.explorer && value.length === 66) {
    return (
      <a className="hash" href={`${chain.explorer}/tx/${value}`} target="_blank" rel="noreferrer" title={value}>
        {text}
      </a>
    );
  }
  return (
    <span className="hash" title={value}>
      {text}
    </span>
  );
}

export function Modal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export type TxStage = "idle" | "wallet" | "ledger";

/**
 * Runs an action that needs a wallet signature: `sign` opens MetaMask and returns the transaction hash,
 * `confirm` tells the server, which checks the transaction on the ledger before changing anything.
 */
export function useTx() {
  const [stage, setStage] = useState<TxStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(sign: () => Promise<string>, confirm: (txHash: string) => Promise<T>): Promise<T | undefined> => {
    setError(null);
    try {
      setStage("wallet");
      const txHash = await sign();
      setStage("ledger");
      return await confirm(txHash);
    } catch (e) {
      setError(messageOf(e));
      return undefined;
    } finally {
      setStage("idle");
    }
  }, []);
  return { stage, busy: stage !== "idle", error, setError, run };
}

export function TxModal({ stage, title }: { stage: TxStage; title: string }) {
  if (stage === "idle") return null;
  return (
    <Modal label={title}>
      <div className="row">
        <span className="spinner" />
        <h2 className="h2">{title}</h2>
      </div>
      {stage === "wallet" ? (
        <p style={{ margin: 0 }}>Confirm the request in MetaMask. Nothing is recorded until you sign.</p>
      ) : (
        <p style={{ margin: 0 }}>Signed. Waiting for the transaction to be included on the ledger…</p>
      )}
    </Modal>
  );
}

/** Runs a plain server action and tracks its state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(messageOf(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <Banner tone="danger">{message}</Banner> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted" style={{ margin: 0 }}>{children}</p>;
}
