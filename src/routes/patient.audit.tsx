import { createFileRoute } from "@tanstack/react-router";
import { Badge, Empty, Hash } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime } from "~/lib/format";
import { getAuditLog } from "~/server/api.functions";

export const Route = createFileRoute("/patient/audit")({
  loader: async () => call(getAuditLog()),
  component: Audit,
});

const KIND = {
  GRANT: { label: "Access granted", tone: "active" },
  REVOKE: { label: "Access revoked", tone: "muted" },
  OVERRIDE: { label: "Emergency override", tone: "danger" },
  DISPUTE: { label: "Record disputed", tone: "pending" },
} as const;

function Audit() {
  const entries = Route.useLoaderData();
  const overrides = entries.filter((e) => e.kind === "OVERRIDE").length;
  return (
    <>
      <div>
        <h1 className="h1">Audit log</h1>
        <p className="lede">Every grant, revocation, emergency override and dispute on your record. Each entry is checked against the ledger: a hospital cannot remove or alter one.</p>
      </div>
      <div className="grid3">
        <div className="card tight stat">
          <b>{entries.length}</b>
          <span>Events on your record</span>
        </div>
        <div className="card tight stat">
          <b>{overrides}</b>
          <span>Emergency overrides</span>
        </div>
        <div className="card tight stat">
          <b>{entries.filter((e) => e.verifiedOnChain).length}</b>
          <span>Confirmed on the ledger</span>
        </div>
      </div>
      <section className="card">
        {!entries.length ? (
          <Empty>Nothing has happened on your record yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table t-stack">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Practitioner</th>
                  <th>Hospital</th>
                  <th>Ledger</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td data-l="When">{fmtDateTime(e.at)}</td>
                    <td data-l="Event">
                      <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
                    </td>
                    <td data-l="Practitioner">
                      <b>{e.practitioner}</b>
                      <div className="small muted mono">{e.licenseNo}</div>
                    </td>
                    <td data-l="Hospital">{e.hospital}</td>
                    <td data-l="Ledger">{e.verifiedOnChain ? <Hash value={e.txHash} /> : <span className="small muted">Historic entry, not on this ledger</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
