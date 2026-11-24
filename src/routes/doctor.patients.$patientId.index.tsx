import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { Timeline } from "~/components/Timeline";
import { useMe } from "~/components/session";
import { Banner, ErrorBanner, Icon, useAction } from "~/components/ui";
import { call, CallError } from "~/lib/call";
import { age, fmtDate } from "~/lib/format";
import { dischargePatient, getPatientTimeline } from "~/server/api.functions";

export const Route = createFileRoute("/doctor/patients/$patientId/")({
  validateSearch: (s: Record<string, unknown>): { saved?: string } => ({ saved: typeof s.saved === "string" ? s.saved : undefined }),
  loader: async ({ params }) => {
    try {
      return await call(getPatientTimeline({ data: { patientId: params.patientId } }));
    } catch (e) {
      // No access (never granted, revoked or expired): back to the directory, where access can be requested.
      if (e instanceof CallError && e.status === 403) throw redirect({ to: "/doctor/patients" });
      throw e;
    }
  },
  component: PatientRecord,
});

function PatientRecord() {
  const data = Route.useLoaderData();
  const { saved } = Route.useSearch();
  const { patientId } = Route.useParams();
  const me = useMe();
  const router = useRouter();
  const act = useAction();
  const p = data.patient;
  const here = data.admission && data.admission.hospitalId === me.hospitalId;
  return (
    <>
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <Link className="link small" to="/doctor/patients">
            Back to patients
          </Link>
          <h1 className="h1" style={{ marginTop: 8 }}>
            {p.name}
          </h1>
          <p className="lede">
            <span className="mono">{p.code}</span> · {p.sex === "F" ? "Female" : "Male"}, {age(p.dateOfBirth)} · Blood group {p.bloodGroup ?? "not recorded"} · Genotype {p.genotype ?? "not recorded"}
          </p>
        </div>
        <div className="row grow-sm">
          <Link className="btn btn-primary" to="/doctor/patients/$patientId/entry" params={{ patientId }}>
            <Icon name="plus" /> New entry
          </Link>
          <Link className="btn btn-secondary" to="/doctor/patients/$patientId/order" params={{ patientId }}>
            <Icon name="flask" /> Order investigations
          </Link>
        </div>
      </div>
      {saved === "entry" ? <Banner tone="ok"><b>Entry saved.</b> No conflict was found, and its hash is anchored on the ledger.</Banner> : null}
      {saved === "dispute" ? <Banner tone="ok"><b>Dispute recorded.</b> The original entry is kept and marked disputed; your correction is linked to it and anchored on the ledger.</Banner> : null}
      <ErrorBanner message={act.error} />
      {data.admission ? (
        <Banner tone="chain" icon="bed">
          Admitted to <b>{data.admission.ward}</b>, {data.admission.hospital}
          {data.admission.bed ? `, bed ${data.admission.bed}` : ""} since {fmtDate(data.admission.admittedAt)}.{" "}
          {here ? (
            <button
              type="button"
              className="link"
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
              disabled={act.busy}
              onClick={() => act.run(() => call(dischargePatient({ data: { admissionId: data.admission!.id } }))).then(() => router.invalidate())}
            >
              Discharge the patient
            </button>
          ) : null}
        </Banner>
      ) : null}
      <section className="card">
        <h2 className="h2" style={{ marginBottom: 16 }}>
          Unified timeline
        </h2>
        <Timeline
          data={data}
          action={(r) =>
            r.type === "consultation" ? (
              <Link className="btn btn-ghost" style={{ minHeight: 32, padding: "0 10px" }} to="/doctor/patients/$patientId/dispute/$recordId" params={{ patientId, recordId: r.id }}>
                Dispute
              </Link>
            ) : null
          }
        />
      </section>
    </>
  );
}
