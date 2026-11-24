import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, ErrorBanner, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime } from "~/lib/format";
import { disputeRecord, getCatalogues, getPatientTimeline } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/patients/$patientId/dispute/$recordId")({
  loader: async ({ params }) => {
    const [timeline, cat] = await Promise.all([call(getPatientTimeline({ data: { patientId: params.patientId } })), call(getCatalogues())]);
    return { timeline, cat };
  },
  component: Dispute,
});

function Dispute() {
  const { timeline, cat } = Route.useLoaderData();
  const { patientId, recordId } = Route.useParams();
  const router = useRouter();
  const act = useAction();
  const record = timeline.records.find((r) => r.id === recordId);
  const [corrected, setCorrected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const dxName = (id: string) => cat.diagnoses.find((d) => d.id === id)?.name ?? id;
  const back = { to: "/doctor/patients/$patientId", params: { patientId }, search: { saved: undefined } } as const;

  if (!record) return <Banner tone="danger">That record was not found on this patient's timeline.</Banner>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() => call(disputeRecord({ data: { recordId, correctedDiagnoses: corrected, notes } })));
    if (res) await router.navigate({ to: "/doctor/patients/$patientId", params: { patientId }, search: { saved: "dispute" } });
  };

  return (
    <>
      <div>
        <Link className="link small" {...back}>
          Back to record
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          Dispute a record
        </h1>
        <p className="lede">
          For <b>{timeline.patient.name}</b>. The original entry is never edited or deleted. Your correction is added beside it, both stay visible, and the original stops driving prescription checks.
        </p>
      </div>
      <div className="cols">
        <form className="card stack" onSubmit={submit}>
          <ErrorBanner message={act.error} />
          {record.status === "DISPUTED" ? <Banner tone="warn">This record has already been disputed.</Banner> : null}
          <div className="field">
            <label htmlFor="cdx">Corrected diagnosis</label>
            <select className="select" id="cdx" value="" onChange={(e) => e.target.value && !corrected.includes(e.target.value) && setCorrected([...corrected, e.target.value])}>
              <option value="">Add the diagnosis you believe is correct…</option>
              {cat.diagnoses.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {corrected.length ? (
              <div className="row" style={{ gap: 6 }}>
                {corrected.map((d) => (
                  <span className="pill" key={d}>
                    {dxName(d)}
                    <button type="button" aria-label={`Remove ${dxName(d)}`} onClick={() => setCorrected(corrected.filter((x) => x !== d))} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, fontSize: 16, lineHeight: 1 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="hint">Leave empty if the finding was simply wrong and no diagnosis replaces it.</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="why">Clinical reason</label>
            <textarea className="textarea" id="why" required minLength={10} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="The evidence for the correction: examination, investigation results, dates." />
            <span className="hint">Stored permanently with your name and licence number.</span>
          </div>
          <div className="row grow-sm">
            <button className="btn btn-danger" disabled={act.busy || record.status === "DISPUTED"}>
              {act.busy ? "Anchoring the addendum…" : "Record dispute"}
            </button>
            <Link className="btn btn-secondary" {...back}>
              Cancel
            </Link>
          </div>
        </form>
        <aside className="stack">
          <section className="card disputed">
            <div className="row between">
              <h2 className="h2">Entry being disputed</h2>
              <Badge tone="danger">Will be marked disputed</Badge>
            </div>
            <div className="rec-meta" style={{ marginTop: 10 }}>
              <span>{fmtDateTime(record.timestamp)}</span>
              <span>
                {record.hospital}, {record.city}
              </span>
              <span>{record.author}</span>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              {record.diagnosis.map((d) => (
                <span className="pill" key={d.id}>
                  {d.name}
                </span>
              ))}
            </div>
            <p style={{ margin: "8px 0 0" }}>{record.notes}</p>
          </section>
          <section className="card sunken">
            <h2 className="h3">What happens next</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              A new record pointing to this one is hash-chained and anchored on the ledger. The patient sees the dispute in the audit log, and the Contraindication Engine ignores the disputed entry from now on.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
