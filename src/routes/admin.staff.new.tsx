import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useSession } from "~/components/session";
import { Badge, Banner, ErrorBanner, Hash, TxModal, useAction, useTx } from "~/components/ui";
import { call } from "~/lib/call";
import type { Data } from "~/lib/types";
import { sendContractTx } from "~/lib/wallet";
import { addStaff, confirmStaffVerification, getStaffFormOptions } from "~/server/api.functions";

export const Route = createFileRoute("/admin/staff/new")({
  loader: async () => call(getStaffFormOptions()),
  component: AddStaff,
});

const TYPE_FOR: Record<string, string> = { doctor: "CLINICAL", nurse: "WARD", lab_technician: "LABORATORY" };
const REGULATOR: Record<string, string> = { doctor: "Medical and Dental Council of Nigeria", nurse: "Nursing and Midwifery Council of Nigeria", lab_technician: "Medical Laboratory Science Council of Nigeria" };

function AddStaff() {
  const { departments } = Route.useLoaderData();
  const me = useMe();
  const { chain } = useSession();
  const act = useAction();
  const tx = useTx();
  const [f, setF] = useState({ name: "", email: "", password: "", role: "doctor", departmentId: "", licenseNo: "", wallet: "", position: "" });
  const [created, setCreated] = useState<Data<typeof addStaff> | null>(null);
  const [checked, setChecked] = useState(false);
  const [verifiedTx, setVerifiedTx] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, ...(k === "role" ? { departmentId: "" } : {}) });
  const options = departments.filter((d) => d.type === TYPE_FOR[f.role]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() => call(addStaff({ data: f })));
    if (res) setCreated(res);
  };
  const verify = async () => {
    if (!created) return;
    const res = await tx.run(
      () => sendContractTx(chain, me.user.wallet, "verifyPractitioner", [created.wallet, created.licenseNo]),
      (txHash) => call(confirmStaffVerification({ data: { affiliationId: created.affiliationId, txHash } })),
    );
    if (res) setVerifiedTx(res.txHash);
  };

  return (
    <>
      <div>
        <Link className="link small" to="/admin">
          Back to staff
        </Link>
        <h1 className="h1" style={{ marginTop: 8 }}>
          Add and verify a practitioner
        </h1>
        <p className="lede">Create the account, confirm the licence with the regulator, then sign the verification with the hospital's admin wallet. Until you sign, the practitioner cannot work with patient records.</p>
      </div>
      <TxModal stage={tx.stage} title="Verifying the practitioner" />
      <div className="cols">
        <form className="card stack" onSubmit={create}>
          <div className="row between">
            <h2 className="h2">1. Account details</h2>
            {created ? <Badge tone="active">Created</Badge> : null}
          </div>
          <ErrorBanner message={act.error} />
          <fieldset disabled={Boolean(created)} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <div className="grid2">
              <div className="field">
                <label htmlFor="n">Full name</label>
                <input className="input" id="n" required value={f.name} onChange={set("name")} />
              </div>
              <div className="field">
                <label htmlFor="e">Email address</label>
                <input className="input" id="e" type="email" required value={f.email} onChange={set("email")} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="r">Role</label>
                <select className="select" id="r" value={f.role} onChange={set("role")}>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="lab_technician">Laboratory technician</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="d">Department</label>
                <select className="select" id="d" required value={f.departmentId} onChange={set("departmentId")}>
                  <option value="">Choose…</option>
                  {options.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {!options.length ? (
                  <span className="hint">
                    Your hospital has no {TYPE_FOR[f.role].toLowerCase()} department yet.{" "}
                    <Link className="link" to="/admin/hospital">
                      Add one
                    </Link>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="l">Licence number</label>
                <input className="input mono" id="l" required value={f.licenseNo} onChange={set("licenseNo")} />
                <span className="hint">{REGULATOR[f.role]}</span>
              </div>
              <div className="field">
                <label htmlFor="p">Position (optional)</label>
                <input className="input" id="p" placeholder="For example, Consultant" value={f.position} onChange={set("position")} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="w">Practitioner's wallet address</label>
              <input className="input mono" id="w" required placeholder="0x…" value={f.wallet} onChange={set("wallet")} />
              <span className="hint">The practitioner signs with this wallet. It cannot be changed afterwards.</span>
            </div>
            <div className="field">
              <label htmlFor="pw">Initial password</label>
              <input className="input" id="pw" type="password" minLength={8} value={f.password} onChange={set("password")} autoComplete="new-password" />
              <span className="hint">Give it to the practitioner in person. Leave empty if the practitioner already has a PRMS account at another hospital.</span>
            </div>
          </fieldset>
          {!created ? (
            <div className="row grow-sm">
              <button className="btn btn-primary" disabled={act.busy}>
                {act.busy ? "Creating…" : "Create account"}
              </button>
              <Link className="btn btn-secondary" to="/admin">
                Cancel
              </Link>
            </div>
          ) : null}
        </form>

        <aside className="stack">
          <section className="card stack">
            <div className="row between">
              <h2 className="h2">2. Verify the licence</h2>
              {verifiedTx ? <Badge tone="active">Verified</Badge> : <Badge tone="pending">Not verified</Badge>}
            </div>
            <ErrorBanner message={tx.error} />
            {verifiedTx ? (
              <>
                <Banner tone="ok">
                  <b>{f.name} is verified at your hospital.</b> The verification is on the ledger. <Hash value={verifiedTx} />
                </Banner>
                <Link className="btn btn-primary" to="/admin">
                  Back to staff
                </Link>
              </>
            ) : (
              <>
                <p className="small" style={{ margin: 0 }}>
                  Check the licence number with the {REGULATOR[f.role]} before you sign. Your signature is the hospital's statement that this person is licensed.
                </p>
                <label className="check">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={!created} />
                  <span>I have confirmed this licence with the regulator.</span>
                </label>
                <button className="btn btn-primary" disabled={!created || !checked || tx.busy} onClick={verify}>
                  Sign verification
                </button>
                {!created ? <span className="hint">Create the account first.</span> : <span className="hint">You can also verify later from the staff list.</span>}
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
