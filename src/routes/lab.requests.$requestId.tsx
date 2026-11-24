import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, Hash, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime, until } from "~/lib/format";
import type { Data } from "~/lib/types";
import { getLabRequest, uploadResult } from "~/server/api.functions";

export const Route = createFileRoute("/lab/requests/$requestId")({
  loader: async ({ params }) => call(getLabRequest({ data: { requestId: params.requestId } })),
  component: Upload,
});

function Upload() {
  const r = Route.useLoaderData();
  const { requestId } = Route.useParams();
  const act = useAction();
  const [result, setResult] = useState("");
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<Data<typeof uploadResult> | null>(null);
  const closed = r.status !== "PENDING";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() => call(uploadResult({ data: { requestId, upload: { token: r.token ?? "", result, comment } } })));
    if (res) setDone(res);
  };

  return (
    <>
      <div>
        <Link className="link small" to="/lab">
          Back to work queue
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          {r.investigation}
        </h1>
        <p className="lede">
          Requisition <span className="mono">{r.code}</span> · ordered by {r.orderedBy}, {r.orderedFrom}, {fmtDateTime(r.orderedAt)}
        </p>
      </div>
      {done ? (
        <Banner tone="ok">
          <b>Result accepted.</b> It was encrypted for the ordering physician and anchored on the ledger; the token is now used up. <Hash value={done.txHash} label="anchored" />{" "}
          <Link className="link" to="/lab">
            Back to the queue
          </Link>
        </Banner>
      ) : null}
      {act.error ? (
        <Banner tone="danger">
          <b>Upload refused.</b> {act.error}
        </Banner>
      ) : null}
      <div className="cols">
        <form className="card stack" onSubmit={submit}>
          <h2 className="h2">Result</h2>
          {closed && !done ? <Banner tone="warn">This requisition has already been fulfilled. Its token cannot be used again.</Banner> : null}
          {r.expired && !closed ? <Banner tone="warn">The token for this requisition has expired. An upload will be refused; the doctor must place a new order.</Banner> : null}
          <div className="field">
            <label htmlFor="res">Findings</label>
            <textarea className="textarea" id="res" required style={{ minHeight: 160 }} value={result} onChange={(e) => setResult(e.target.value)} placeholder={"One value per line, for example:\nHaemoglobin 12.1 g/dL\nWhite cell count 7.4 x10^9/L"} disabled={Boolean(done) || closed} />
          </div>
          <div className="field">
            <label htmlFor="com">Comment for the physician (optional)</label>
            <input className="input" id="com" value={comment} onChange={(e) => setComment(e.target.value)} disabled={Boolean(done) || closed} />
          </div>
          <div className="row grow-sm">
            <button className="btn btn-primary" disabled={act.busy || Boolean(done) || closed}>
              {act.busy ? "Encrypting and anchoring…" : "Upload result"}
            </button>
            <Link className="btn btn-secondary" to="/lab">
              Cancel
            </Link>
          </div>
        </form>
        <aside className="stack">
          <section className="card">
            <h2 className="h2">Requisition</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Patient</dt>
              <dd>
                {r.patient} <span className="mono small muted">{r.patientCode}</span>
              </dd>
              <dt>Specimen</dt>
              <dd>{r.specimen ?? "Not stated"}</dd>
              <dt>Clinical indication</dt>
              <dd>{r.clinicalIndication ?? "Not stated"}</dd>
              <dt>Token</dt>
              <dd>
                {closed || done ? <Badge>Used</Badge> : r.expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="pending">Valid, expires {until(r.expiresAt)}</Badge>}
                <div style={{ marginTop: 6 }}>
                  <Hash value={"0x" + r.tokenHash} label="token" />
                </div>
              </dd>
            </dl>
          </section>
          <section className="card sunken">
            <h2 className="h3">Write-only access</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              The token lets you upload one result for this requisition. It does not let you read the patient's record, and once used or expired it stops working.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
