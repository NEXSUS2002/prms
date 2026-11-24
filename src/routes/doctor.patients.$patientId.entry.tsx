import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, ErrorBanner, Icon, Modal, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDate } from "~/lib/format";
import type { Data } from "~/lib/types";
import { createEntry, getCatalogues, getEntryContext } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/patients/$patientId/entry")({
  loader: async ({ params }) => {
    const [ctx, cat] = await Promise.all([call(getEntryContext({ data: { patientId: params.patientId } })), call(getCatalogues())]);
    return { ctx, cat };
  },
  component: NewEntry,
});

type Med = { drug: string; dose: string; frequency: string; duration: string; ongoing: boolean };
type Conflict = NonNullable<Extract<Data<typeof createEntry>, { saved: false }>["conflict"]>;
const emptyMed = (): Med => ({ drug: "", dose: "", frequency: "Once daily", duration: "", ongoing: false });
const FREQ = ["Once daily", "Twice daily", "Three times daily", "Four times daily", "At night", "When required", "Single dose"];

function NewEntry() {
  const { ctx, cat } = Route.useLoaderData();
  const { patientId } = Route.useParams();
  const router = useRouter();
  const act = useAction();
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [meds, setMeds] = useState<Med[]>([emptyMed()]);
  const [ward, setWard] = useState("");
  const [bed, setBed] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [showModal, setShowModal] = useState(false);
  const p = ctx.patient;
  const dxName = (id: string) => cat.diagnoses.find((d) => d.id === id)?.name ?? id;
  const setMed = (i: number, patch: Partial<Med>) => {
    setMeds(meds.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    setConflict(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() =>
      call(createEntry({ data: { patientId, entry: { diagnoses, notes, medications: meds.filter((m) => m.drug), admission: ward ? { departmentId: ward, bed } : null } } })),
    );
    if (!res) return;
    if (res.saved) {
      await router.navigate({ to: "/doctor/patients/$patientId", params: { patientId }, search: { saved: "entry" } });
    } else {
      setConflict(res.conflict);
      setShowModal(true);
    }
  };

  return (
    <>
      <div>
        <Link className="link small" to="/doctor/patients/$patientId" params={{ patientId }} search={{ saved: undefined }}>
          Back to record
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          New clinical entry
        </h1>
        <p className="lede">
          For <b>{p.name}</b>, <span className="mono">{p.code}</span>. The prescription is checked against the patient's full history, from every hospital, before it can be saved.
        </p>
      </div>
      <div className="cols">
        <form className="card stack" aria-label="Entry form" onSubmit={submit}>
          <ErrorBanner message={act.error} />
          <div className="field">
            <label htmlFor="dx">Diagnosis</label>
            <select
              className="select"
              id="dx"
              value=""
              onChange={(e) => {
                if (e.target.value && !diagnoses.includes(e.target.value)) setDiagnoses([...diagnoses, e.target.value]);
                setConflict(null);
              }}
            >
              <option value="">Add a diagnosis…</option>
              {cat.diagnoses.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {diagnoses.length ? (
              <div className="row" style={{ gap: 6 }}>
                {diagnoses.map((d) => (
                  <span className="pill" key={d}>
                    {dxName(d)}
                    <button type="button" aria-label={`Remove ${dxName(d)}`} onClick={() => setDiagnoses(diagnoses.filter((x) => x !== d))} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="hint">Leave empty for a review visit with no new diagnosis.</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="notes">Clinical notes</label>
            <textarea className="textarea" id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <hr className="divider" />
          <div className="row between">
            <h2 className="h2">Prescription</h2>
            <button type="button" className="btn btn-ghost" onClick={() => setMeds([...meds, emptyMed()])}>
              Add medication
            </button>
          </div>
          {conflict ? (
            <Banner tone="danger">
              <b>
                {conflict.drugName} conflicts with {conflict.conflictsWithName}.
              </b>{" "}
              Remove or replace it to continue. Rule <span className="mono">{conflict.ruleId}</span>.
            </Banner>
          ) : null}
          {meds.map((m, i) => (
            <div key={i} className="stack-sm">
              <div className="grid3">
                <div className="field">
                  <label htmlFor={`m${i}`}>Medication</label>
                  <select className={`select ${conflict?.drug === m.drug && m.drug ? "err" : ""}`} id={`m${i}`} value={m.drug} onChange={(e) => setMed(i, { drug: e.target.value })} style={conflict?.drug === m.drug && m.drug ? { borderColor: "var(--color-danger)" } : undefined}>
                    <option value="">None</option>
                    {cat.drugs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`d${i}`}>Dose</label>
                  <input className="input" id={`d${i}`} placeholder="For example, 5 mg" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`f${i}`}>Frequency</label>
                  <select className="select" id={`f${i}`} value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })}>
                    {FREQ.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row between">
                <label className="check" style={{ flex: 1 }}>
                  <input type="checkbox" checked={m.ongoing} onChange={(e) => setMed(i, { ongoing: e.target.checked })} />
                  <span>Ongoing medication (keeps this drug in future prescription checks)</span>
                </label>
                <input className="input" style={{ maxWidth: 160 }} placeholder="Duration" aria-label="Duration" value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} />
                {meds.length > 1 ? (
                  <button type="button" className="rm" onClick={() => setMeds(meds.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <hr className="divider" />
          <div className="grid2">
            <div className="field">
              <label htmlFor="adm">Admission</label>
              <select className="select" id="adm" value={ward} onChange={(e) => setWard(e.target.value)}>
                <option value="">Not admitted (outpatient)</option>
                {ctx.wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    Admit to {w.name}
                  </option>
                ))}
              </select>
              <span className="hint">Wards of the hospital you are working at. An admitted patient appears on that ward's nursing list.</span>
            </div>
            <div className="field">
              <label htmlFor="bed">
                Bed <span className="small muted">(if admitted)</span>
              </label>
              <input className="input mono" id="bed" placeholder="For example, 04" value={bed} onChange={(e) => setBed(e.target.value)} disabled={!ward} />
            </div>
          </div>
          <div className="row grow-sm">
            <button className="btn btn-primary" disabled={act.busy}>
              {act.busy ? "Checking and anchoring…" : "Check and save entry"}
            </button>
            <Link className="btn btn-secondary" to="/doctor/patients/$patientId" params={{ patientId }} search={{ saved: undefined }}>
              Cancel
            </Link>
          </div>
        </form>

        <aside className="stack">
          <section className="card">
            <h2 className="h2">Checked against</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Active diagnoses</dt>
              <dd>
                {!ctx.activeDiagnoses.length ? "None recorded" : null}
                {ctx.activeDiagnoses.map((d) => (
                  <div key={d.name} style={{ marginBottom: 6 }}>
                    <Badge tone="pending">{d.name}</Badge>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      {fmtDate(d.at)} · {d.hospital}
                    </div>
                  </div>
                ))}
              </dd>
              <dt>Ongoing medication</dt>
              <dd>{ctx.ongoingMedication.length ? ctx.ongoingMedication.join(", ") : "None recorded"}</dd>
              <dt>Disputed records</dt>
              <dd>{ctx.disputedCount ? `${ctx.disputedCount} (ignored by the check)` : "None"}</dd>
            </dl>
          </section>
          <section className="card sunken">
            <h2 className="h3">How the check works</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              A fixed list of high-risk drug–diagnosis and drug–drug conflicts, taken from the Nigeria Standard Treatment Guidelines. It names the exact rule each time it blocks, and the decision stays with you.
            </p>
          </section>
        </aside>
      </div>

      {conflict && showModal ? (
        <Modal label="Prescription blocked">
          <div className="row" style={{ color: "var(--color-danger)" }}>
            <Icon name="warn" />
            <h2 className="h2">Prescription blocked</h2>
          </div>
          <p style={{ margin: 0 }}>
            <b>{conflict.drugName}</b> must not be given to this patient. Nothing was saved.
          </p>
          <dl className="kv card tight" style={{ background: "var(--color-danger-soft)", borderColor: "var(--oxblood-200)" }}>
            <dt>Conflict</dt>
            <dd>{conflict.type === "DRUG_DIAGNOSIS_CONFLICT" ? "Drug–diagnosis" : "Drug–drug"}</dd>
            <dt>Conflicts with</dt>
            <dd>
              <b>{conflict.conflictsWithName}</b>
              {conflict.recordedAtHospital ? `, recorded ${fmtDate(conflict.recordedAt)} at ${conflict.recordedAtHospital}` : " (in this same entry)"}
            </dd>
            <dt>Reason</dt>
            <dd>{conflict.reason}</dd>
            <dt>Rule</dt>
            <dd>
              <span className="mono">{conflict.ruleId}</span> · {conflict.sourceDocument.replace(/\s*\(.*\)$/, "")}, p. {conflict.sourcePage}
            </dd>
          </dl>
          {conflict.recordId ? <p className="small muted" style={{ margin: 0 }}>If you believe the earlier entry is wrong, dispute that record instead of working around the check.</p> : null}
          <div className="row grow-sm">
            <button className="btn btn-primary" onClick={() => setShowModal(false)}>
              Change prescription
            </button>
            {conflict.recordId && conflict.type === "DRUG_DIAGNOSIS_CONFLICT" ? (
              <Link className="btn btn-secondary" to="/doctor/patients/$patientId/dispute/$recordId" params={{ patientId, recordId: conflict.recordId }}>
                Dispute the diagnosis
              </Link>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
