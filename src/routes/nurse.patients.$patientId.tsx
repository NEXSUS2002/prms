import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { VitalsGrid } from "~/components/Timeline";
import { Badge, Banner, Empty, ErrorBanner, Hash, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { age, fmtDate, fmtDateTime } from "~/lib/format";
import { getCareSummary, recordObservation } from "~/server/api.functions";

export const Route = createFileRoute("/nurse/patients/$patientId")({
  loader: async ({ params }) => call(getCareSummary({ data: { patientId: params.patientId } })),
  component: Vitals,
});

const EMPTY = { blood_pressure: "", temperature_c: "", pulse_bpm: "", respiratory_rate: "", spo2_percent: "" };

function Vitals() {
  const s = Route.useLoaderData();
  const { patientId } = Route.useParams();
  const router = useRouter();
  const act = useAction();
  const [v, setV] = useState(EMPTY);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    const res = await act.run(() => call(recordObservation({ data: { patientId, observation: { vitals: v, notes } } })));
    if (!res) return;
    setSaved(res.txHash);
    setV(EMPTY);
    setNotes("");
    await router.invalidate();
  };

  return (
    <>
      <div>
        <Link className="link small" to="/nurse">
          Back to ward
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          {s.patient.name}
        </h1>
        <p className="lede">
          <span className="mono">{s.patient.code}</span> · {s.patient.sex === "F" ? "Female" : "Male"}, {age(s.patient.dateOfBirth)} · Bed <span className="mono">{s.admission.bed ?? "–"}</span> · admitted {fmtDate(s.admission.admittedAt)} · Blood group {s.patient.bloodGroup ?? "not recorded"}
        </p>
      </div>
      {saved ? (
        <Banner tone="ok">
          <b>Observation saved</b> to the patient's timeline under your name. <Hash value={saved} label="anchored" />
        </Banner>
      ) : null}
      <div className="cols">
        <div className="stack">
          <form className="card stack" onSubmit={submit}>
            <h2 className="h2">Record vital signs</h2>
            <ErrorBanner message={act.error} />
            <div className="grid3">
              <div className="field">
                <label htmlFor="bp">Blood pressure</label>
                <input className="input mono" id="bp" placeholder="120/80" value={v.blood_pressure} onChange={set("blood_pressure")} />
              </div>
              <div className="field">
                <label htmlFor="t">Temperature °C</label>
                <input className="input mono" id="t" inputMode="decimal" placeholder="36.8" value={v.temperature_c} onChange={set("temperature_c")} />
              </div>
              <div className="field">
                <label htmlFor="pr">Pulse /min</label>
                <input className="input mono" id="pr" inputMode="numeric" placeholder="78" value={v.pulse_bpm} onChange={set("pulse_bpm")} />
              </div>
              <div className="field">
                <label htmlFor="rr">Respiratory rate /min</label>
                <input className="input mono" id="rr" inputMode="numeric" placeholder="16" value={v.respiratory_rate} onChange={set("respiratory_rate")} />
              </div>
              <div className="field">
                <label htmlFor="sp">SpO₂ %</label>
                <input className="input mono" id="sp" inputMode="numeric" placeholder="98" value={v.spo2_percent} onChange={set("spo2_percent")} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="n">Nursing notes</label>
              <textarea className="textarea" id="n" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="row grow-sm">
              <button className="btn btn-primary" disabled={act.busy}>
                {act.busy ? "Saving and anchoring…" : "Save observation"}
              </button>
            </div>
          </form>
          <section className="card">
            <h2 className="h2">Recent observations</h2>
            <div className="stack" style={{ marginTop: 12 }}>
              {!s.observations.length ? <Empty>No observation has been recorded.</Empty> : null}
              {s.observations.map((o) => (
                <div key={o.id}>
                  <div className="rec-meta">
                    <span>{fmtDateTime(o.timestamp)}</span>
                    <span>{o.author}</span>
                  </div>
                  {o.vitals ? <VitalsGrid vitals={o.vitals} /> : null}
                  {o.notes ? <p className="small" style={{ margin: "6px 0 0" }}>{o.notes}</p> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="stack">
          <section className="card">
            <h2 className="h2">Care summary</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Reason for admission</dt>
              <dd>{s.admission.reason ?? "Not recorded"}</dd>
              <dt>Active diagnoses</dt>
              <dd>
                <div className="row" style={{ gap: 6 }}>
                  {s.diagnoses.length ? s.diagnoses.map((d) => <Badge key={d} tone="pending">{d}</Badge>) : "None recorded"}
                </div>
              </dd>
              <dt>Active medications</dt>
              <dd>
                {s.medications.length
                  ? s.medications.map((m) => (
                      <div key={m.name}>
                        <b>{m.name}</b> {[m.dose, m.frequency].filter(Boolean).join(", ")}
                      </div>
                    ))
                  : "None recorded"}
              </dd>
              <dt>Allergy notes</dt>
              <dd>{s.allergyNotes.length ? s.allergyNotes.map((a) => <div key={a}>{a}</div>) : "None recorded"}</dd>
            </dl>
          </section>
          <section className="card sunken">
            <h2 className="h3">What you can do here</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              Record vital signs and nursing notes. Prescribing, ordering tests, disputing a record and the patient's history at other hospitals are outside the nursing role.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
