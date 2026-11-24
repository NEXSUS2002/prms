import { createFileRoute } from "@tanstack/react-router";
import { Badge, Empty, Hash } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDateTime } from "~/lib/format";
import { getLabHistory } from "~/server/api.functions";

export const Route = createFileRoute("/lab/history")({
  loader: async () => call(getLabHistory()),
  component: History,
});

function History() {
  const rows = Route.useLoaderData();
  return (
    <>
      <div>
        <h1 className="h1">Upload history</h1>
        <p className="lede">Results you have uploaded. Only the fact of each upload is shown; the stored result is encrypted for the ordering physician.</p>
      </div>
      <section className="card">
        {!rows.length ? (
          <Empty>You have not uploaded a result yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table t-stack">
              <thead>
                <tr>
                  <th>Requisition</th>
                  <th>Investigation</th>
                  <th>Patient no.</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                  <th>Ledger</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td data-l="Requisition" className="mono">
                      {r.code}
                    </td>
                    <td data-l="Investigation">
                      <b>{r.investigation}</b>
                    </td>
                    <td data-l="Patient no." className="mono">
                      {r.patientCode}
                    </td>
                    <td data-l="Uploaded">{fmtDateTime(r.uploadedAt)}</td>
                    <td data-l="Status">
                      <Badge tone="active">Accepted</Badge>
                    </td>
                    <td data-l="Ledger">{r.txHash ? <Hash value={r.txHash} /> : <span className="small muted">Historic upload</span>}</td>
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
