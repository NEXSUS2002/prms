import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Empty } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDate, fmtDateTime } from "~/lib/format";
import { getWardList } from "~/server/api.functions";

export const Route = createFileRoute("/nurse/")({
  loader: async () => call(getWardList()),
  component: Ward,
});

function Ward() {
  const ward = Route.useLoaderData();
  return (
    <>
      <div>
        <div className="eyebrow">{ward.hospital}</div>
        <h1 className="h1" style={{ marginTop: 6 }}>
          {ward.ward}
        </h1>
        <p className="lede">Patients admitted to your ward. You see the care summary of these patients only.</p>
      </div>
      <div className="cols">
        <section className="card">
          <h2 className="h2">
            Admitted patients <span className="small muted">{ward.patients.length}</span>
          </h2>
          <div className="stack" style={{ marginTop: 16 }}>
            {!ward.patients.length ? <Empty>No patient is admitted to this ward.</Empty> : null}
            {ward.patients.map((p, i) => (
              <div key={p.patientId}>
                {i ? <hr className="divider" style={{ marginBottom: 16 }} /> : null}
                <div className="row between">
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <span className="avatar mono">{p.bed ?? "–"}</span>
                    <div>
                      <div className="h3">
                        {p.name} <span className="mono small muted">{p.code}</span>
                      </div>
                      <div className="small muted">
                        {p.reason ?? "Reason not recorded"} · admitted {fmtDate(p.admittedAt)}
                      </div>
                      <div className="small muted">
                        {p.lastObservationAt ? `Last observation ${fmtDateTime(p.lastObservationAt)}` : "No observation recorded yet"}
                        {p.lastVitals?.blood_pressure ? ` · BP ${p.lastVitals.blood_pressure}` : ""}
                      </div>
                    </div>
                  </div>
                  <Link className="btn btn-primary" to="/nurse/patients/$patientId" params={{ patientId: p.patientId }}>
                    Care summary
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="h2">Results awaited</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            {!ward.awaited.length ? <Empty>No laboratory result is awaited for this ward.</Empty> : null}
            {ward.awaited.map((a) => (
              <div key={a.code}>
                <div className="row between">
                  <div className="h3">{a.investigation}</div>
                  <Badge tone="pending">Awaited</Badge>
                </div>
                <div className="small muted">
                  {a.patient} · {a.department} · <span className="mono">{a.code}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
