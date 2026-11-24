import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "~/components/AuthArt";
import { ErrorBanner } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { landingFor } from "~/lib/guard";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    const to = landingFor(context.session);
    if (to) throw redirect({ href: to });
  },
  component: SignIn,
});

function SignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Read the fields from the form itself, so text typed before the page finished loading is not lost.
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    if (res.error) {
      setError(res.error.status === 401 ? "The email or password is not correct." : (res.error.message ?? "Sign-in failed."));
      setBusy(false);
      return;
    }
    await router.invalidate();
    await router.navigate({ to: "/" });
  };

  return (
    <AuthLayout
      headline="One health record. You decide who reads it."
      points={[
        { title: "Every hospital, one timeline", text: "Your history follows you instead of staying in one hospital's files." },
        { title: "Access is yours to give", text: "A doctor reads your record only after you approve it from your wallet." },
        { title: "Nothing is erased", text: "A wrong entry is disputed and corrected in the open, never deleted." },
      ]}
    >
      <div>
        <div className="eyebrow">Patient Records Management System</div>
        <h1 className="h1" style={{ marginTop: 8 }}>
          Sign in
        </h1>
        <p className="lede">Patients, hospital staff, hospital administrators and the registrar all sign in here.</p>
      </div>
      <form className="stack" method="post" onSubmit={submit}>
        <ErrorBanner message={error} />
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input className="input" id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>
        New patient?{" "}
        <Link className="link" to="/register">
          Create your record
        </Link>
        <br />
        Hospital management?{" "}
        <Link className="link" to="/register-hospital">
          Register your hospital
        </Link>
      </p>
    </AuthLayout>
  );
}
