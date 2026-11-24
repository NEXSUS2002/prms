import { createFileRoute } from "@tanstack/react-router";
import { parseResult } from "~/components/Timeline";
import { Badge, Empty, Hash } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime, until } from "~/lib/format";
import { getDoctorOrders } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/orders")({
  loader: async () => call(getDoctorOrders()),
  component: Orders,
});

function Orders() {
  const orders = Route.useLoaderData();
  return (
    <>
      <div>
        <h1 className="h1">Lab orders</h1>
        <p className="lede">Every investigation you have ordered. Results stay available to you here even after your access to the patient's full record has ended.</p>
      </div>
      <section className="card stack">
        {!orders.length ? <Empty>You have not ordered any investigation. Open a patient's record and choose Order investigations.</Empty> : null}
        {orders.map((o, i) => {
          const res = parseResult(o.result);
          return (
            <div key={o.id}>
              {i ? <hr className="divider" style={{ marginBottom: 16 }} /> : null}
              <div className="row between">
                <div>
                  <div className="h3">
                    {o.investigation} <span className="mono small muted">{o.code}</span>
                  </div>
                  <div className="small muted">
                    {o.patient} ({o.patientCode}) · {o.department}, {o.hospital} · ordered {fmtDateTime(o.orderedAt)}
                  </div>
                </div>
                {o.status === "FULFILLED" ? <Badge tone="chain">Result uploaded</Badge> : o.status === "EXPIRED" ? <Badge>Token expired</Badge> : <Badge tone="pending">Awaited · token ends {until(o.expiresAt)}</Badge>}
              </div>
              {res ? (
                <div style={{ marginTop: 10 }}>
                  <div className="result-text">{res.result}</div>
                  {res.comment ? <p className="small" style={{ margin: "6px 0 0" }}>{res.comment}</p> : null}
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="small muted">Uploaded {fmtDateTime(o.uploadedAt)}</span>
                    <Hash value={o.txHash} label="anchored" />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}
