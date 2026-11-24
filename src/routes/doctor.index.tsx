import { createFileRoute, Link } from "@tanstack/react-router";
import { useMe } from "~/components/session";
import { Badge, Empty } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDate, until } from "~/lib/format";
import { getDoctorOrders, searchPatients } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/")({
  loader: async () => {
    const [patients, orders] = await Promise.all([call(searchPatients({ data: { query: "" } })), call(getDoctorOrders())]);
    return { patients, orders };
  },
  component: DoctorHome,
});

function DoctorHome() {
  const { patients, orders } = Route.useLoaderData();
  const me = useMe();
  const open = patients.filter((p) => p.access === "GRANTED" || p.access === "EMERGENCY");
  const pending = patients.filter((p) => p.access === "PENDING");
  const awaited = orders.filter((o) => o.status === "PENDING");
  const results = orders.filter((o) => o.status === "FULFILLED").slice(0, 5);
  return (
    <>
      <div>
        <div className="eyebrow">{me.working?.hospitalName}</div>
        <h1 className="h1" style={{ marginTop: 6 }}>
          {me.user.name}
        </h1>
        <p className="lede">
          {me.working?.departmentName}
          {me.working?.position ? ` · ${me.working.position}` : ""} · Licence <span className="mono">{me.user.licenseNo}</span>
        </p>
      </div>
      <div className="grid3">
        <div className="card tight stat">
          <b>{open.length}</b>
          <span>Records you can open now</span>
        </div>
        <div className="card tight stat">
          <b>{pending.length}</b>
          <span>Requests waiting for the patient</span>
        </div>
        <div className="card tight stat">
          <b>{awaited.length}</b>
          <span>Laboratory results awaited</span>
        </div>
      </div>
      <div className="cols">
        <section className="card">
          <div className="row between">
            <h2 className="h2">Patients with active access</h2>
            <Link className="btn btn-ghost" to="/doctor/patients">
              Find a patient
            </Link>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {!open.length ? <Empty>No patient has granted you access at the moment. Find a patient and request access.</Empty> : null}
            {open.map((p) => (
              <div className="row between" key={p.id}>
                <div>
                  <div className="h3">
                    {p.name} <span className="mono small muted">{p.code}</span>
                  </div>
                  <div className="small muted">Access ends {until(p.expiresAt)}</div>
                </div>
                <div className="row">
                  {p.access === "EMERGENCY" ? <Badge tone="danger">Emergency</Badge> : <Badge tone="active">Granted</Badge>}
                  <Link className="btn btn-secondary" to="/doctor/patients/$patientId" params={{ patientId: p.id }}>
                    Open record
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="row between">
            <h2 className="h2">Latest results</h2>
            <Link className="btn btn-ghost" to="/doctor/orders">
              All orders
            </Link>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {!results.length ? <Empty>No results have been uploaded for your orders yet.</Empty> : null}
            {results.map((o) => (
              <div key={o.id}>
                <div className="h3">{o.investigation}</div>
                <div className="small muted">
                  {o.patient} · {fmtDate(o.uploadedAt)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
