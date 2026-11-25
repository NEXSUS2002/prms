import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "~/lib/auth-client";
import { call, messageOf } from "~/lib/call";
import { roleLabel, shortHash } from "~/lib/format";
import { connectWallet, metaMaskAppLink, useWallet } from "~/lib/wallet";
import { setWorkingHospital } from "~/server/api.functions";
import { useMe, useSession } from "./session";
import { Icon } from "./ui";

export type NavItem = { to: string; label: string; icon: string; exact?: boolean };

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="plus" />
      </span>
      PRMS
    </div>
  );
}

/** The wallet pill: shows whether MetaMask is on the right network and on the account bound to this user. */
function WalletPill() {
  const me = useMe();
  const { chain } = useSession();
  const wallet = useWallet();
  const [note, setNote] = useState<string | null>(null);
  const bound = me.user.wallet;
  // Nurses and laboratory technicians never sign anything in MetaMask: the PRMS server records their entries and
  // results on the ledger. Their pill only names the network, so a MetaMask that holds other accounts is no error.
  if (me.user.role === "nurse" || me.user.role === "lab_technician") {
    return (
      <span className="wallet" title="Your entries are recorded on the ledger by the PRMS server. You do not need to sign in MetaMask.">
        <span className="dot" />
        {chain.chainName}
        {bound ? <span className="addr">· {shortHash(bound)}</span> : null}
      </span>
    );
  }
  const onChain = wallet.chainId === chain.chainId;
  // Ready when MetaMask shares the bound wallet with this site, even if another shared account is selected:
  // every transaction names the bound wallet as the sender, and MetaMask signs with it.
  const matches = Boolean(bound && wallet.accounts.includes(bound));
  const state = !wallet.installed ? "none" : !wallet.account ? "disconnected" : !onChain ? "network" : !matches ? "account" : "ok";
  if (state === "none") {
    // A phone has no MetaMask extension. The MetaMask app's own browser provides the wallet instead, so link there.
    const mobile = wallet.mobile;
    return (
      <a
        className="wallet"
        style={{ textDecoration: "none" }}
        href={mobile ? metaMaskAppLink() : "https://metamask.io/download/"}
        target={mobile ? undefined : "_blank"}
        rel="noreferrer"
        title={
          mobile
            ? "Continue in the MetaMask app's browser, where PRMS can reach your wallet. You will sign in to PRMS there again."
            : "MetaMask was not found in this browser. Install the extension, then reload this page."
        }
      >
        <span className="dot danger" />
        {mobile ? "Open in MetaMask" : "MetaMask not found"}
        {bound ? <span className="addr">· {shortHash(bound)}</span> : null}
      </a>
    );
  }
  const text = {
    disconnected: "Connect wallet",
    network: `Switch to ${chain.chainName}`,
    account: "Choose account",
    ok: chain.chainName,
  }[state];
  const hint =
    state === "account" && bound
      ? `MetaMask has not shared ${shortHash(bound)} with PRMS yet. Click, then tick that account in MetaMask.`
      : bound
        ? `Bound wallet ${bound}`
        : "No wallet bound";
  return (
    <button
      type="button"
      className="wallet"
      style={{ cursor: state === "ok" ? "default" : "pointer" }}
      title={note ?? hint}
      onClick={async () => {
        if (state === "ok") return;
        try {
          await connectWallet(chain, bound);
          setNote(null);
        } catch (e) {
          setNote(messageOf(e));
        }
      }}
    >
      <span className={`dot ${state === "ok" ? "" : state === "account" ? "danger" : "warn"}`} />
      {text}
      {bound ? <span className="addr">· {shortHash(bound)}</span> : null}
    </button>
  );
}

function HospitalSwitcher() {
  const me = useMe();
  const router = useRouter();
  if (me.affiliations.length < 2) return null;
  return (
    <label className="switcher">
      Working at
      <select
        className="select"
        value={me.hospitalId ?? ""}
        onChange={async (e) => {
          await call(setWorkingHospital({ data: { hospitalId: e.target.value } }));
          await router.invalidate();
        }}
      >
        {me.affiliations.map((a) => (
          <option key={a.hospitalId} value={a.hospitalId}>
            {a.hospitalName}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Shell({ nav }: { nav: NavItem[] }) {
  const me = useMe();
  const router = useRouter();
  const verified = me.working ? me.working.status === "ACTIVE" : true;
  const where = me.working?.hospitalName ?? (me.user.role === "registrar" ? "Network registry" : "My health record");
  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };
  return (
    <div className="vp">
      <div className="app">
        <aside className="side">
          <Brand />
          <nav className="nav" aria-label={roleLabel[me.user.role]}>
            {nav.map((n) => (
              <Link key={n.to} to={n.to} activeOptions={{ exact: n.exact ?? false }} activeProps={{ "aria-current": "page" }}>
                <Icon name={n.icon} />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <span className="role">
              {roleLabel[me.user.role]}
              {me.working && me.user.role !== "hospital_admin" ? (verified ? " · Verified" : " · Not verified") : ""}
            </span>
            <b>{me.user.name}</b>
            <span>{where}</span>
            <button type="button" onClick={signOut} style={{ color: "inherit", marginTop: 8, background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", textDecoration: "underline", font: "inherit" }}>
              Sign out
            </button>
          </div>
        </aside>
        <div className="main">
          <header className="top">
            <Brand />
            <div className="crumb">
              {where}
              {me.working?.departmentName ? ` / ${me.working.departmentName}` : ""}
            </div>
            <div className="row">
              <HospitalSwitcher />
              <WalletPill />
              <button type="button" className="btn btn-ghost hide-lg" onClick={signOut} style={{ minHeight: 32, padding: "0 10px" }}>
                Sign out
              </button>
            </div>
          </header>
          <main className="content">
            {me.working && !verified && me.user.role !== "hospital_admin" ? (
              <div className="banner banner-warn" role="status">
                <Icon name="warn" />
                <div>
                  <b>Your account is {me.working.status === "SUSPENDED" ? "suspended" : "not yet verified"}.</b> Your hospital's administrator must verify your licence on the ledger before you can work with patient records.
                </div>
              </div>
            ) : null}
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
