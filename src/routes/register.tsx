import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "~/components/AuthArt";
import { useSession } from "~/components/session";
import { ErrorBanner } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { call, messageOf } from "~/lib/call";
import { landingFor } from "~/lib/guard";
import { completePatientProfile } from "~/server/api.functions";

export const Route = createFileRoute("/register")({
  beforeLoad: ({ context }) => {
    const to = landingFor(context.session);
    if (to && to !== "/register") throw redirect({ href: to });
  },
  component: Register,
});

function Register() {
  const router = useRouter();
  const { me } = useSession();
  // A patient who created the account but has not finished the profile sees only the second half.
  const accountExists = Boolean(me);
  const [f, setF] = useState({ name: "", email: "", password: "", dateOfBirth: "", sex: "F", bloodGroup: "", genotype: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!accountExists) {
        const res = await authClient.signUp.email({ name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password });
        if (res.error) throw new Error(res.error.message ?? "The account could not be created.");
      }
      await call(completePatientProfile({ data: { dateOfBirth: f.dateOfBirth, sex: f.sex, bloodGroup: f.bloodGroup, genotype: f.genotype } }));
      await router.invalidate();
      await router.navigate({ to: "/wallet" });
    } catch (err) {
      setError(messageOf(err));
      await router.invalidate();
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      headline="Create your health record."
      points={[
        { tag: "Step 1", title: "Your details", text: "An account and the basic facts every clinician needs." },
        { tag: "Step 2", title: "Connect a wallet", text: "Your wallet is the key that approves or refuses access." },
        { tag: "Step 3", title: "Your timeline", text: "Entries from every hospital you attend appear in one place." },
      ]}
    >
      <div>
        <div className="eyebrow">Patient registration</div>
        <h1 className="h1" style={{ marginTop: 8 }}>
          {accountExists ? "Finish your registration" : "Create your record"}
        </h1>
        <p className="lede">For patients. Hospital staff are added by their hospital's administrator.</p>
      </div>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner message={error} />
        {!accountExists ? (
          <>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input className="input" id="name" required value={f.name} onChange={set("name")} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input className="input" id="email" type="email" required value={f.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input className="input" id="password" type="password" required minLength={8} value={f.password} onChange={set("password")} autoComplete="new-password" />
              <span className="hint">At least 8 characters</span>
            </div>
          </>
        ) : null}
        <div className="grid2 keep2">
          <div className="field">
            <label htmlFor="dob">Date of birth</label>
            <input className="input" id="dob" type="date" required value={f.dateOfBirth} onChange={set("dateOfBirth")} />
          </div>
          <div className="field">
            <label htmlFor="sex">Sex</label>
            <select className="select" id="sex" value={f.sex} onChange={set("sex")}>
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
          </div>
        </div>
        <div className="grid2 keep2">
          <div className="field">
            <label htmlFor="bg">Blood group</label>
            <select className="select" id="bg" value={f.bloodGroup} onChange={set("bloodGroup")}>
              <option value="">Not known</option>
              {["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gt">Genotype</label>
            <select className="select" id="gt" value={f.genotype} onChange={set("genotype")}>
              <option value="">Not known</option>
              {["AA", "AS", "AC", "SS", "SC"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Saving…" : "Continue to wallet"}
        </button>
      </form>
      {!accountExists ? (
        <p className="small muted" style={{ margin: 0 }}>
          Already registered?{" "}
          <Link className="link" to="/">
            Sign in
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
