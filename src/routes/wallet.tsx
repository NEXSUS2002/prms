import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "~/components/AuthArt";
import { useMe, useSession } from "~/components/session";
import { Badge, Banner, ErrorBanner, Icon } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { call, messageOf } from "~/lib/call";
import { shortHash } from "~/lib/format";
import { connectWallet, hasWallet, metaMaskAppLink, signBinding, useWallet } from "~/lib/wallet";
import { bindWallet } from "~/server/api.functions";

export const Route = createFileRoute("/wallet")({
  beforeLoad: ({ context }) => {
    const me = context.session.me;
    if (!me) throw redirect({ href: "/" });
    if (me.user.role === "patient" && !me.patientId) throw redirect({ href: "/register" });
  },
  component: WalletPage,
});

function WalletPage() {
  const me = useMe();
  const { chain } = useSession();
  const router = useRouter();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bound = me.user.wallet;
  const connected = Boolean(wallet.account);
  const onNetwork = wallet.chainId === chain.chainId;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = () => act(async () => void (await connectWallet(chain, bound)));
  const bind = () =>
    act(async () => {
      const signed = await signBinding(chain, bound, me.bindingMessage);
      await call(bindWallet({ data: signed }));
      await router.invalidate();
    });
  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };

  return (
    <AuthLayout
      headline="Your wallet is your key."
      points={[
        { title: "No password is sent to the ledger", text: "You prove who you are by signing with your wallet." },
        { title: "Signing a message is free", text: "Binding your wallet costs nothing. Only changes recorded on the ledger need test ETH." },
        { title: `Network: ${chain.chainName}`, text: "This is a test network. The ETH on it has no real value." },
      ]}
    >
      <div>
        <div className="eyebrow">Connect wallet</div>
        <h1 className="h1" style={{ marginTop: 8 }}>
          {bound ? "Wallet bound" : "Bind your wallet"}
        </h1>
        <p className="lede">Signed in as {me.user.name}.</p>
      </div>
      <ErrorBanner message={error} />
      {!hasWallet() ? (
        wallet.mobile ? (
          <Banner tone="warn">
            <b>On a phone, MetaMask works inside its own app.</b> Open PRMS in the MetaMask app's browser and sign in there
            again.{" "}
            <a className="link" href={metaMaskAppLink()}>
              Open in MetaMask
            </a>
          </Banner>
        ) : (
          <Banner tone="warn">
            <b>MetaMask was not found in this browser.</b> Install the MetaMask extension from metamask.io, then reload this page.
          </Banner>
        )
      ) : null}

      <div className="card stack">
        <div className="row between">
          <div>
            <div className="h3">1. Connect MetaMask</div>
            <div className="small muted">{connected ? `Connected: ${shortHash(wallet.account)}` : "Choose the account you will use for PRMS."}</div>
          </div>
          {connected ? <Badge tone="active">Connected</Badge> : <button className="btn btn-secondary" disabled={busy || !hasWallet()} onClick={connect}>Connect</button>}
        </div>
        <hr className="divider" />
        <div className="row between">
          <div>
            <div className="h3">2. {chain.chainName} network</div>
            <div className="small muted">{onNetwork ? "MetaMask is on the right network." : "MetaMask will ask to switch network."}</div>
          </div>
          {onNetwork ? <Badge tone="active">Ready</Badge> : <button className="btn btn-secondary" disabled={busy || !connected} onClick={connect}>Switch</button>}
        </div>
        <hr className="divider" />
        <div className="row between">
          <div>
            <div className="h3">3. Sign once to bind</div>
            <div className="small muted">{bound ? `This account is bound to ${shortHash(bound)}.` : "A free signature that ties this wallet to your account."}</div>
          </div>
          {bound ? <Badge tone="active">Bound</Badge> : <button className="btn btn-primary" disabled={busy || !connected || !onNetwork} onClick={bind}>{busy ? "Waiting…" : "Sign and bind"}</button>}
        </div>
      </div>

      {bound ? (
        <>
          <Banner tone="ok">
            <b>Your wallet is bound.</b> Use this same MetaMask account whenever PRMS asks you to sign.
          </Banner>
          <button className="btn btn-primary btn-block" onClick={() => router.navigate({ to: "/" })}>
            <Icon name="check" /> Continue
          </button>
        </>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        Not you?{" "}
        <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} onClick={signOut}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  );
}
