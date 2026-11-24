import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Empty } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime, until } from "~/lib/format";
import { getLabQueue } from "~/server/api.functions";

export const Route = createFileRoute("/lab/")({
  loader: async () => call(getLabQueue()),
  component: Queue,
});

function Queue() {
  const q = Route.useLoaderData();
  const open = q.requests.filter((r) => !r.expired);
  const expired = q.requests.filter((r) => r.expired);
  return (
    <>
      <div>
        <div className="eyebrow">{q.hospital}</div>
        <h1 className="h1" style={{ marginTop: 6 }}>
          {q.department} work queue
        </h1>
        <p className="lede">Requisitions addressed to your department. You see the test, the specimen and the clinical indication. The patient's history is not available to this role.</p>
      </div>
      <section className="card">
        <h2 className="h2">
          Open requisitions <span className="small muted">{open.length}</span>
        </h2>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          {!open.length ? (
            <Empty>No requisition is waiting.</Empty>
          ) : (
            <table className="table t-stack">
              <thead>
                <tr>
                  <th>Requisition</th>
                  <th>Investigation</th>
                  <th>Patient</th>
                  <th>Ordered by</th>
                  <th>Token</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.map((r) => (
                  <tr key={r.id}>
                    <td data-l="Requisition" className="mono">
                      {r.code}
                    </td>
                    <td data-l="Investigation">
                      <b>{r.investigation}</b>
                      <div className="small muted">{r.specimen}</div>
                    </td>
                    <td data-l="Patient">
                      {r.patient} <span className="mono small muted">{r.patientCode}</span>
                    </td>
                    <td data-l="Ordered by">
                      {r.orderedBy}
                      <div className="small muted">
                        {r.orderedFrom} · {fmtDateTime(r.orderedAt)}
                      </div>
                    </td>
                    <td data-l="Token">
                      <Badge tone="pending">Expires {until(r.expiresAt)}</Badge>
                    </td>
                    <td data-l="">
                      <Link className="btn btn-primary" to="/lab/requests/$requestId" params={{ requestId: r.id }}>
                        Upload result
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {expired.length ? (
        <section className="card">
          <h2 className="h2">Expired tokens</h2>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            A result can no longer be uploaded for these. The doctor must place a new order.
          </p>
          {expired.map((r) => (
            <div className="row between" key={r.id} style={{ padding: "8px 0" }}>
              <div>
                <b>{r.investigation}</b> <span className="mono small muted">{r.code}</span>
                <div className="small muted">
                  {r.patient} · ordered by {r.orderedBy}
                </div>
              </div>
              <div className="row">
                <Badge>Expired</Badge>
                <Link className="btn btn-secondary" to="/lab/requests/$requestId" params={{ requestId: r.id }}>
                  View
                </Link>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
