import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Banner, ErrorBanner, Hash, useAction } from "~/components/ui";
import { call } from "~/lib/call";
import { fmtDate } from "~/lib/format";
import { addDepartment, getHospitalProfile, setDepartmentSharing } from "~/server/api.functions";

export const Route = createFileRoute("/admin/hospital")({
  loader: async () => call(getHospitalProfile()),
  component: HospitalProfile,
});

const TYPE: Record<string, string> = { LABORATORY: "Laboratory", CLINICAL: "Clinical", WARD: "Ward" };
const LEVEL: Record<string, string> = { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary" };

function HospitalProfile() {
  const { hospital, departments } = Route.useLoaderData();
  const router = useRouter();
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "LABORATORY", accepts: false });
  const labs = departments.filter((d) => d.type === "LABORATORY");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() => call(addDepartment({ data: { name: form.name, type: form.type, acceptsOutsideRequisitions: form.accepts } })));
    if (!res) return;
    setAdded(res.name);
    setAdding(false);
    setForm({ name: "", type: "LABORATORY", accepts: false });
    await router.invalidate();
  };
  const share = async (departmentId: string, accepts: boolean) => {
    await act.run(() => call(setDepartmentSharing({ data: { departmentId, accepts } })));
    await router.invalidate();
  };

  return (
    <>
      <div>
        <div className="eyebrow">Hospital profile</div>
        <h1 className="h1" style={{ marginTop: 6 }}>
          {hospital.name}
        </h1>
        <div className="row" style={{ marginTop: 10 }}>
          {hospital.status === "ACTIVE" ? <Badge tone="active">Active on the network</Badge> : <Badge tone="danger">Suspended by the registrar</Badge>}
          <Hash value={hospital.registeredTx} label="registered" />
        </div>
      </div>
      <ErrorBanner message={act.error} />
      <div className="cols">
        <div className="stack">
          <section className="card">
            <h2 className="h2">Details</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Hospital ID</dt>
              <dd className="mono">{hospital.code}</dd>
              <dt>Level of care</dt>
              <dd>{LEVEL[hospital.level] ?? hospital.level}</dd>
              <dt>Location</dt>
              <dd>
                {hospital.city}, {hospital.state}
              </dd>
              <dt>Facility registration</dt>
              <dd className="mono">{hospital.facilityRegistrationNo}</dd>
              <dt>Joined the network</dt>
              <dd>{fmtDate(hospital.joinedAt)}</dd>
              <dt>Admin wallet</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                {hospital.adminWallet}
              </dd>
            </dl>
          </section>

          <section className="card">
            <div className="row between" style={{ marginBottom: 4 }}>
              <h2 className="h2">
                Departments <span className="small muted">{departments.length}</span>
              </h2>
              {!adding ? (
                <button className="btn btn-ghost" onClick={() => { setAdding(true); setAdded(null); }}>
                  Add department
                </button>
              ) : null}
            </div>
            <p className="small muted" style={{ margin: "0 0 12px" }}>
              You define the departments your hospital actually has. Staff are assigned to them, and doctors can send tests only to the laboratory departments listed here.
            </p>
            {added ? (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="ok">
                  <b>{added} added.</b> You can now assign staff to it.
                </Banner>
              </div>
            ) : null}
            {adding ? (
              <form className="card sunken stack" style={{ marginBottom: 12 }} aria-label="New department" onSubmit={save}>
                <div className="grid2">
                  <div className="field">
                    <label htmlFor="dn">Department name</label>
                    <input className="input" id="dn" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="dt">Type</label>
                    <select className="select" id="dt" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                      <option value="LABORATORY">Laboratory (receives requisitions)</option>
                      <option value="CLINICAL">Clinical (doctors)</option>
                      <option value="WARD">Ward (nurses and admitted patients)</option>
                    </select>
                  </div>
                </div>
                {form.type === "LABORATORY" ? (
                  <label className="check">
                    <input type="checkbox" checked={form.accepts} onChange={(e) => setForm({ ...form, accepts: e.target.checked })} />
                    <span>Accept requisitions from other hospitals</span>
                  </label>
                ) : null}
                <div className="row grow-sm">
                  <button className="btn btn-primary" disabled={act.busy}>
                    Save department
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
            <div className="table-wrap">
              <table className="table t-stack">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Type</th>
                    <th>Staff</th>
                    <th>Requisitions from other hospitals</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td data-l="Department">
                        <b>{d.name}</b>
                      </td>
                      <td data-l="Type">{TYPE[d.type]}</td>
                      <td data-l="Staff" className="mono">
                        {d.staffCount}
                      </td>
                      <td data-l="Outside requisitions">
                        {d.type !== "LABORATORY" ? <span className="small muted">Not applicable</span> : d.acceptsOutsideRequisitions ? <Badge tone="active">Accepted</Badge> : <Badge>Own patients only</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2 className="h2">Laboratory sharing</h2>
            <p className="small" style={{ margin: "8px 0 12px" }}>
              When a laboratory department accepts outside requisitions, doctors at other hospitals can send it tests. Your technicians still see the requisition only.
            </p>
            {!labs.length ? <p className="small muted" style={{ margin: 0 }}>Add a laboratory department to set this.</p> : null}
            {labs.map((d, i) => (
              <label className="check" key={d.id} style={i ? { marginTop: 8 } : undefined}>
                <input type="checkbox" checked={Boolean(d.acceptsOutsideRequisitions)} disabled={act.busy} onChange={(e) => share(d.id, e.target.checked)} />
                <span>
                  <b>{d.name}</b> accepts requisitions from other hospitals
                </span>
              </label>
            ))}
          </section>
          <section className="card sunken">
            <h2 className="h3">What the hospital does not control</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              Patient records belong to the patient, not to the hospital that wrote them. The hospital cannot grant access to a record, edit it or delete it.
            </p>
          </section>
          <section className="card sunken">
            <h2 className="h3">Other hospitals</h2>
            <p className="small" style={{ margin: "6px 0 0" }}>
              The list of hospitals on the network is kept by the platform registrar and is not shown to hospital administrators. Your doctors see only the laboratories that accept outside requisitions, at the moment they order a test.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
