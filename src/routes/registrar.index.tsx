import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useSession } from "~/components/session";
import { Badge, Banner, Empty, ErrorBanner, Hash, TxModal, useAction, useTx } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime, shortHash } from "~/lib/format";
import type { Data } from "~/lib/types";
import { sendContractTx } from "~/lib/wallet";
import { confirmHospitalApproval, confirmHospitalStatus, getRegistry, rejectApplication } from "~/server/api.functions";

export const Route = createFileRoute("/registrar/")({
  loader: async () => call(getRegistry()),
  component: Registry,
});

type App = Data<typeof getRegistry>["applications"][number];
const LEVEL: Record<string, string> = { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary" };

function Review({ app, busy, onApprove, onReject }: { app: App; busy: boolean; onApprove: () => void; onReject: (note: string) => void }) {
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  return (
    <article className="card stack">
      <div className="row between">
        <div>
          <div className="eyebrow">{app.reference}</div>
          <h3 className="h2" style={{ marginTop: 4 }}>
            {app.name}
          </h3>
          <div className="small muted">Submitted {fmtDateTime(app.submittedAt)}</div>
        </div>
        <Badge tone="pending">Awaiting review</Badge>
      </div>
      <dl className="kv">
        <dt>Location</dt>
        <dd>
          {app.city}, {app.state}
        </dd>
        <dt>Level of care</dt>
        <dd>{LEVEL[app.level] ?? app.level}</dd>
        <dt>Facility registration</dt>
        <dd className="mono">{app.facilityRegistrationNo}</dd>
        <dt>Laboratories declared</dt>
        <dd>{app.departments.length ? app.departments.join(", ") : "None"}</dd>
        <dt>Administrator</dt>
        <dd>
          {app.adminName} · {app.adminEmail}
        </dd>
        <dt>Admin wallet</dt>
        <dd className="mono" style={{ overflowWrap: "anywhere" }}>
          {app.adminWallet}
        </dd>
      </dl>
      {app.walletBoundTo ? (
        <Banner tone="danger">
          <b>This admin wallet is already bound to {app.walletBoundTo}.</b> One wallet administers one hospital, so the ledger will refuse this application. Reject it and ask the hospital for a different wallet.
        </Banner>
      ) : (
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I have confirmed the facility registration number with the State Ministry of Health.</span>
        </label>
      )}
      <div className="field">
        <label htmlFor={"note" + app.id}>Reason, if rejecting</label>
        <input className="input" id={"note" + app.id} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row grow-sm">
        <button className="btn btn-primary" disabled={busy || !checked || Boolean(app.walletBoundTo)} onClick={onApprove}>
          Approve and sign
        </button>
        <button className="btn btn-danger-outline" disabled={busy} onClick={() => onReject(note)}>
          Reject
        </button>
      </div>
    </article>
  );
}

function Registry() {
  const { hospitals, applications } = Route.useLoaderData();
  const me = useMe();
  const { chain } = useSession();
  const router = useRouter();
  const tx = useTx();
  const plain = useAction();
  const [title, setTitle] = useState("");
  const [approved, setApproved] = useState<{ name: string; code: string; txHash: string } | null>(null);
  const waiting = applications.filter((a) => a.status === "AWAITING_REVIEW");
  const decided = applications.filter((a) => a.status !== "AWAITING_REVIEW");

  const approve = async (app: App) => {
    setTitle("Recording the hospital on the ledger");
    const res = await tx.run(
      () => sendContractTx(chain, me.user.wallet, "registerHospital", [app.plannedIdHash, app.adminWallet]),
      (txHash) => call(confirmHospitalApproval({ data: { applicationId: app.id, txHash } })),
    );
    if (res) setApproved({ name: app.name, code: res.code, txHash: res.txHash });
    await router.invalidate();
  };
  const reject = async (app: App, note: string) => {
    await plain.run(() => call(rejectApplication({ data: { applicationId: app.id, note } })));
    await router.invalidate();
  };
  const setActive = async (h: (typeof hospitals)[number], active: boolean) => {
    setTitle(active ? "Reinstating the hospital" : "Suspending the hospital");
    await tx.run(
      () => sendContractTx(chain, me.user.wallet, "setHospitalActive", [h.idHash, active]),
      (txHash) => call(confirmHospitalStatus({ data: { hospitalId: h.id, txHash } })),
    );
    await router.invalidate();
  };

  return (
    <>
      <div>
        <div className="eyebrow">Platform registrar</div>
        <h1 className="h1" style={{ marginTop: 6 }}>
          Hospitals on the network
        </h1>
        <p className="lede">You admit and suspend hospitals. You do not see their staff, and you cannot open any patient's record: each hospital's administrator verifies its own practitioners.</p>
      </div>
      <ErrorBanner message={tx.error ?? plain.error} />
      <TxModal stage={tx.stage} title={title} />
      {approved ? (
        <Banner tone="ok">
          <b>
            {approved.name} is now on the network as {approved.code}.
          </b>{" "}
          Its administrator can sign in and add departments and staff. <Hash value={approved.txHash} />
        </Banner>
      ) : null}
      <div className="grid3">
        <div className="card tight stat">
          <b>{hospitals.length}</b>
          <span>Hospitals registered</span>
        </div>
        <div className="card tight stat">
          <b>{waiting.length}</b>
          <span>Applications awaiting review</span>
        </div>
        <div className="card tight stat">
          <b>{hospitals.filter((h) => h.status !== "ACTIVE").length}</b>
          <span>Suspended</span>
        </div>
      </div>

      <section className="stack">
        <h2 className="h2">Applications</h2>
        {!waiting.length ? (
          <div className="card">
            <Empty>No application is waiting for review.</Empty>
          </div>
        ) : null}
        <div className="grid2">
          {waiting.map((a) => (
            <Review key={a.id} app={a} busy={tx.busy || plain.busy} onApprove={() => approve(a)} onReject={(note) => reject(a, note)} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="h2">Registered hospitals</h2>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table t-stack">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Location</th>
                <th>Level</th>
                <th>Admin wallet</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hospitals.map((h) => (
                <tr key={h.id}>
                  <td data-l="Hospital">
                    <b>{h.name}</b>
                    <div className="small muted mono">{h.code}</div>
                  </td>
                  <td data-l="Location">
                    {h.city}, {h.state}
                  </td>
                  <td data-l="Level">{LEVEL[h.level] ?? h.level}</td>
                  <td data-l="Admin wallet" className="mono small">
                    {shortHash(h.adminWallet)}
                  </td>
                  <td data-l="Status">
                    {h.status === "ACTIVE" ? <Badge tone="active">Active</Badge> : <Badge tone="danger">Suspended</Badge>}
                    <div style={{ marginTop: 4 }}>
                      <Hash value={h.registeredTx} />
                    </div>
                  </td>
                  <td data-l="">
                    {h.status === "ACTIVE" ? (
                      <button className="btn btn-danger-outline" style={{ minHeight: 36, padding: "0 12px" }} disabled={tx.busy} onClick={() => setActive(h, false)}>
                        Suspend
                      </button>
                    ) : (
                      <button className="btn btn-secondary" style={{ minHeight: 36, padding: "0 12px" }} disabled={tx.busy} onClick={() => setActive(h, true)}>
                        Reinstate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {decided.length ? (
        <section className="card">
          <h2 className="h2">Decided applications</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            {decided.map((a) => (
              <div className="row between" key={a.id}>
                <div>
                  <b>{a.name}</b> <span className="mono small muted">{a.reference}</span>
                  <div className="small muted">
                    Decided {fmtDateTime(a.decidedAt)}
                    {a.decisionNote ? ` · ${a.decisionNote}` : ""}
                  </div>
                </div>
                {a.status === "APPROVED" ? <Badge tone="active">Approved</Badge> : <Badge tone="danger">Rejected</Badge>}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
