import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "~/components/AuthArt";
import { Badge, Banner, ErrorBanner } from "~/components/ui";
import { call, messageOf } from "~/lib/call";
import { submitApplication } from "~/server/api.functions";

export const Route = createFileRoute("/register-hospital")({ component: RegisterHospital });

const STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];
const LABS = ["Haematology", "Radiology", "Chemical Pathology", "Medical Microbiology", "Histopathology", "Blood Bank"];

function RegisterHospital() {
  const [f, setF] = useState({ name: "", level: "secondary", state: "Lagos", city: "", facilityRegistrationNo: "", adminName: "", adminEmail: "", adminWallet: "", adminPassword: "", other: "" });
  const [labs, setLabs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; name: string; adminName: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const departments = [...labs, ...f.other.split(",").map((x) => x.trim()).filter(Boolean)];
      setDone(await call(submitApplication({ data: { ...f, departments } })));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      wide
      headline="Bring your hospital onto the network."
      points={[
        { tag: "Step 1", title: "Apply", text: "Tell us about the facility and who will administer it." },
        { tag: "Step 2", title: "Registrar review", text: "The platform registrar checks the facility registration." },
        { tag: "Step 3", title: "Hospital recorded on the ledger", text: "Your admin wallet becomes the only one that can verify your staff." },
        { tag: "Step 4", title: "Add your departments and staff", text: "Doctors, nurses and laboratory staff, each with a verified licence." },
      ]}
    >
      <div>
        <div className="eyebrow">Hospital registration</div>
        <h1 className="h1" style={{ marginTop: 8 }}>
          Register a hospital
        </h1>
        <p className="lede">For hospital management. Patients and staff do not use this form.</p>
      </div>

      {done ? (
        <div className="stack">
          <Banner tone="warn" icon="clock">
            <b>Application received.</b> It is waiting for the platform registrar. Once the hospital is recorded on the ledger, the administrator can sign in with the email and password given here.
          </Banner>
          <dl className="kv card tight">
            <dt>Reference</dt>
            <dd className="mono">{done.reference}</dd>
            <dt>Hospital</dt>
            <dd>{done.name}</dd>
            <dt>Administrator</dt>
            <dd>{done.adminName}</dd>
            <dt>Status</dt>
            <dd>
              <Badge tone="pending">Awaiting registrar</Badge>
            </dd>
          </dl>
          <Link className="btn btn-secondary btn-block" to="/">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorBanner message={error} />
          <div className="field">
            <label htmlFor="hn">Hospital name</label>
            <input className="input" id="hn" required value={f.name} onChange={set("name")} />
          </div>
          <div className="grid2 keep2">
            <div className="field">
              <label htmlFor="lv">Level of care</label>
              <select className="select" id="lv" value={f.level} onChange={set("level")}>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="tertiary">Tertiary</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="st">State</label>
              <select className="select" id="st" value={f.state} onChange={set("state")}>
                {STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid2 keep2">
            <div className="field">
              <label htmlFor="ct">City or town</label>
              <input className="input" id="ct" required value={f.city} onChange={set("city")} />
            </div>
            <div className="field">
              <label htmlFor="fr">Facility registration number</label>
              <input className="input mono" id="fr" required value={f.facilityRegistrationNo} onChange={set("facilityRegistrationNo")} />
              <span className="hint">As issued by the State Ministry of Health</span>
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
            <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
              Laboratory departments your hospital has
            </legend>
            <div className="grid2 keep2">
              {LABS.map((l) => (
                <label className="check" key={l}>
                  <input type="checkbox" checked={labs.includes(l)} onChange={(e) => setLabs(e.target.checked ? [...labs, l] : labs.filter((x) => x !== l))} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="od">
                Other laboratory departments <span className="small muted">(optional, separate with commas)</span>
              </label>
              <input className="input" id="od" placeholder="For example, Immunology" value={f.other} onChange={set("other")} />
            </div>
            <span className="hint">Tick or type only what your hospital runs. After approval you add your clinical departments and wards, and can change this list, from the hospital profile.</span>
          </fieldset>
          <hr className="divider" />
          <div className="grid2">
            <div className="field">
              <label htmlFor="an">Administrator's name</label>
              <input className="input" id="an" required value={f.adminName} onChange={set("adminName")} />
            </div>
            <div className="field">
              <label htmlFor="ae">Administrator's email</label>
              <input className="input" id="ae" type="email" required value={f.adminEmail} onChange={set("adminEmail")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ap">Administrator's password</label>
            <input className="input" id="ap" type="password" required minLength={8} value={f.adminPassword} onChange={set("adminPassword")} autoComplete="new-password" />
            <span className="hint">The administrator signs in with this once the hospital is approved.</span>
          </div>
          <div className="field">
            <label htmlFor="aw">Administrator's wallet address</label>
            <input className="input mono" id="aw" required placeholder="0x…" value={f.adminWallet} onChange={set("adminWallet")} />
            <span className="hint">This wallet will sign every staff verification for the hospital. Keep it under management control.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Submitting…" : "Submit application"}
          </button>
        </form>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Already on the network?{" "}
        <Link className="link" to="/">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
