import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge, Banner, ErrorBanner, Hash, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { until } from "~/lib/format";
import type { Data } from "~/lib/types";
import { createRequisition, getLabDestinations, getPatientTimeline } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/patients/$patientId/order")({
  loader: async ({ params }) => {
    const [destinations, timeline] = await Promise.all([call(getLabDestinations()), call(getPatientTimeline({ data: { patientId: params.patientId } }))]);
    return { destinations, patient: timeline.patient };
  },
  component: Order,
});

type Picked = { departmentId: string; investigation: string; specimen: string };

function Order() {
  const { destinations, patient } = Route.useLoaderData();
  const { patientId } = Route.useParams();
  const act = useAction();
  const [hospitalId, setHospitalId] = useState(destinations[0]?.id ?? "");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [indication, setIndication] = useState("");
  const [done, setDone] = useState<Data<typeof createRequisition> | null>(null);
  const hospital = useMemo(() => destinations.find((h) => h.id === hospitalId), [destinations, hospitalId]);
  const has = (d: string, t: string) => picked.some((p) => p.departmentId === d && p.investigation === t);
  const toggle = (d: string, t: string, specimen: string, on: boolean) =>
    setPicked(on ? [...picked, { departmentId: d, investigation: t, specimen }] : picked.filter((p) => !(p.departmentId === d && p.investigation === t)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const extra = Object.entries(custom).filter(([, v]) => v.trim()).map(([departmentId, v]) => ({ departmentId, investigation: v.trim(), specimen: "" }));
    const res = await act.run(() => call(createRequisition({ data: { patientId, requisition: { targetHospitalId: hospitalId, items: [...picked, ...extra], indication } } })));
    if (res) setDone(res);
  };
  const back = (
    <Link className="btn btn-primary" to="/doctor/patients/$patientId" params={{ patientId }} search={{ saved: undefined }}>
      Back to record
    </Link>
  );

  return (
    <>
      <div>
        <Link className="link small" to="/doctor/patients/$patientId" params={{ patientId }} search={{ saved: undefined }}>
          Back to record
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          Order investigations
        </h1>
        <p className="lede">
          For <b>{patient.name}</b>, <span className="mono">{patient.code}</span>. Each investigation gets its own upload token. Technicians can upload a result but cannot read the patient's history.
        </p>
      </div>
      {done ? (
        <>
          <Banner tone="ok">
            <b>Requisition sent to {done.hospital}.</b> {done.requests.length} {done.requests.length === 1 ? "token was" : "tokens were"} issued and registered on the ledger. A result appears in the patient's record as soon as it is uploaded.
          </Banner>
          <section className="card stack">
            <h2 className="h2">Tokens issued</h2>
            {done.requests.map((r) => (
              <div key={r.id}>
                <div className="row between">
                  <div className="h3">
                    {r.investigation} <span className="mono small muted">{r.code}</span>
                  </div>
                  <Badge tone="pending">Pending</Badge>
                </div>
                <div className="small muted">
                  {r.department}, {done.hospital} · upload only · expires {until(r.expiresAt)}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <Hash value={"0x" + r.tokenHash} label="token" />
                  <Hash value={r.txHash} label="registered" />
                </div>
              </div>
            ))}
            <div className="row grow-sm">{back}</div>
          </section>
        </>
      ) : (
        <div className="cols">
          <form className="card stack" aria-label="Select investigations" onSubmit={submit}>
            <ErrorBanner message={act.error} />
            <div className="field">
              <label htmlFor="lab">Send to laboratory at</label>
              <select
                className="select"
                id="lab"
                value={hospitalId}
                onChange={(e) => {
                  setHospitalId(e.target.value);
                  setPicked([]);
                  setCustom({});
                }}
              >
                {destinations.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}, {h.city}
                    {h.own ? " (this hospital)" : ""}
                  </option>
                ))}
              </select>
              <span className="hint">Only hospitals whose laboratories accept outside requisitions are listed. All tests in one order go to the same hospital.</span>
            </div>
            {!hospital?.departments.length ? <p className="muted">This hospital has not recorded a laboratory department.</p> : null}
            {hospital?.departments.map((d) => (
              <div key={d.id}>
                <hr className="divider" style={{ marginBottom: 16 }} />
                <div className="row between">
                  <h2 className="h2">{d.name}</h2>
                  <Badge>Token valid {d.validity}</Badge>
                </div>
                <div className="stack-sm" style={{ marginTop: 12 }}>
                  {d.tests.map((t) => (
                    <label className="check" key={t.name}>
                      <input type="checkbox" checked={has(d.id, t.name)} onChange={(e) => toggle(d.id, t.name, t.specimen, e.target.checked)} />
                      <span>
                        <b>{t.name}</b>
                        <br />
                        <span className="small muted">{t.specimen}</span>
                      </span>
                    </label>
                  ))}
                  <input className="input" placeholder={d.tests.length ? "Another investigation (optional)" : "Name the investigation"} aria-label={`Other ${d.name} investigation`} value={custom[d.id] ?? ""} onChange={(e) => setCustom({ ...custom, [d.id]: e.target.value })} />
                </div>
              </div>
            ))}
            <hr className="divider" />
            <div className="field">
              <label htmlFor="ind">Clinical indication (shown to the laboratory)</label>
              <textarea className="textarea" id="ind" value={indication} onChange={(e) => setIndication(e.target.value)} />
              <span className="hint">Only this note and the test details are visible to the technician.</span>
            </div>
            <div className="row grow-sm">
              <button className="btn btn-primary" disabled={act.busy}>
                {act.busy ? "Issuing tokens…" : "Issue tokens and send"}
              </button>
              <Link className="btn btn-secondary" to="/doctor/patients/$patientId" params={{ patientId }} search={{ saved: undefined }}>
                Cancel
              </Link>
            </div>
          </form>
          <aside className="stack">
            <section className="card">
              <h2 className="h2">Requisition summary</h2>
              <div className="stack" style={{ marginTop: 14 }}>
                {!picked.length ? <p className="muted small" style={{ margin: 0 }}>Nothing selected yet.</p> : null}
                {picked.map((p) => {
                  const d = hospital?.departments.find((x) => x.id === p.departmentId);
                  return (
                    <div key={p.departmentId + p.investigation}>
                      <div className="row between">
                        <div className="h3">{p.investigation}</div>
                        <Badge>Not issued</Badge>
                      </div>
                      <div className="small muted">
                        {d?.name}, {hospital?.name} · upload only · valid {d?.validity}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="card sunken">
              <h2 className="h3">Your access to the results</h2>
              <p className="small" style={{ margin: "6px 0 0" }}>
                Results are encrypted for you as the ordering physician. You keep access to these results, under Lab orders, even after your access to the full record ends.
              </p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
