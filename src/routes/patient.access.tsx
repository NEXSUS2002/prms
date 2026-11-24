import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMe, useSession } from "~/components/session";
import { Badge, Empty, ErrorBanner, Hash, TxModal, useAction, useTx } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime, initials, until } from "~/lib/format";
import { sendContractTx } from "~/lib/wallet";
import { confirmGrant, confirmRevoke, declineRequest, listAccess } from "~/server/api.functions";

export const Route = createFileRoute("/patient/access")({
  loader: async () => call(listAccess()),
  component: Access,
});

const PAST: Record<string, string> = { REVOKED: "Revoked by you", EXPIRED: "Expired", DECLINED: "Declined" };

function Access() {
  const data = Route.useLoaderData();
  const me = useMe();
  const { chain } = useSession();
  const router = useRouter();
  const tx = useTx();
  const plain = useAction();

  const approve = (g: (typeof data.pending)[number]) =>
    tx.run(
      () => sendContractTx(chain, me.user.wallet, "grantAccess", [g.practitionerWallet]),
      (txHash) => call(confirmGrant({ data: { grantId: g.id, txHash } })),
    ).then(() => router.invalidate());
  const revoke = (g: (typeof data.active)[number]) =>
    tx.run(
      () => sendContractTx(chain, me.user.wallet, "revokeAccess", [g.practitionerWallet]),
      (txHash) => call(confirmRevoke({ data: { grantId: g.id, txHash } })),
    ).then(() => router.invalidate());
  const decline = (id: string) => plain.run(() => call(declineRequest({ data: { grantId: id } }))).then(() => router.invalidate());

  return (
    <>
      <div>
        <h1 className="h1">Who can read my record</h1>
        <p className="lede">No practitioner can open your history until you approve it here. Each approval lasts 24 hours and you can end it at any time.</p>
      </div>
      <ErrorBanner message={tx.error ?? plain.error} />
      <TxModal stage={tx.stage} title="Recording your decision" />

      <section className="card">
        <h2 className="h2">
          Requests waiting <span className="small muted">{data.pending.length}</span>
        </h2>
        <div className="stack" style={{ marginTop: 16 }}>
          {!data.pending.length ? <Empty>No requests are waiting.</Empty> : null}
          {data.pending.map((g) => (
            <div className="row between" key={g.id}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <span className="avatar">{initials(g.practitioner)}</span>
                <div>
                  <div className="h3">{g.practitioner}</div>
                  <div className="small muted">
                    {g.hospital}, {g.city} · Licence {g.licenseNo ?? "not on file"}
                  </div>
                  <div className="small muted">Requested {fmtDateTime(g.requestedAt)}</div>
                </div>
              </div>
              <div className="row grow-sm">
                <button className="btn btn-primary" disabled={tx.busy || plain.busy} onClick={() => approve(g)}>
                  Approve for 24 hours
                </button>
                <button className="btn btn-secondary" disabled={tx.busy || plain.busy} onClick={() => decline(g.id)}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="h2">
          Active access <span className="small muted">{data.active.length}</span>
        </h2>
        <div className="stack" style={{ marginTop: 16 }}>
          {!data.active.length ? <Empty>Nobody can read your record at the moment.</Empty> : null}
          {data.active.map((g) => (
            <div className="row between" key={g.id}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <span className="avatar">{initials(g.practitioner)}</span>
                <div>
                  <div className="h3">
                    {g.practitioner} {g.grantType === "EMERGENCY" ? <Badge tone="danger">Emergency override</Badge> : <Badge tone="active">Granted</Badge>}
                  </div>
                  <div className="small muted">
                    {g.hospital}, {g.city} · ends {until(g.expiresAt)}
                  </div>
                  <Hash value={g.txHash} />
                </div>
              </div>
              <button className="btn btn-danger-outline" disabled={tx.busy} onClick={() => revoke(g)}>
                Revoke now
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="h2">Past access</h2>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          {!data.past.length ? (
            <Empty>No past access.</Empty>
          ) : (
            <table className="table t-stack">
              <thead>
                <tr>
                  <th>Practitioner</th>
                  <th>Hospital</th>
                  <th>When</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.past.map((g) => (
                  <tr key={g.id}>
                    <td data-l="Practitioner">
                      <b>{g.practitioner}</b>
                    </td>
                    <td data-l="Hospital">{g.hospital}</td>
                    <td data-l="When">{fmtDateTime(g.decidedAt ?? g.requestedAt)}</td>
                    <td data-l="Outcome">
                      <Badge tone={g.grantType === "EMERGENCY" ? "danger" : "muted"}>{g.grantType === "EMERGENCY" ? "Emergency override, ended" : PAST[g.status] ?? g.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
