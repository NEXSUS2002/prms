import { createFileRoute, Link } from "@tanstack/react-router";
import { Timeline } from "~/components/Timeline";
import { Banner } from "~/components/ui";
import { call } from "~/lib/call";
import { age, fmtDate } from "~/lib/format";
import { getMyTimeline, listAccess } from "~/server/api.functions";

export const Route = createFileRoute("/patient/")({
  // Both requests start at once; the page waits for the slower one, not for the two in turn.
  loader: async () => {
    const [timeline, access] = await Promise.all([call(getMyTimeline()), call(listAccess())]);
    return { timeline, access };
  },
  component: PatientTimeline,
});

function PatientTimeline() {
  const { timeline, access } = Route.useLoaderData();
  const p = timeline.patient;
  return (
    <>
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">My health record</div>
          <h1 className="h1" style={{ marginTop: 6 }}>
            {p.name}
          </h1>
          <p className="lede">
            <span className="mono">{p.code}</span> · {p.sex === "F" ? "Female" : "Male"}, {age(p.dateOfBirth)} · Blood group {p.bloodGroup ?? "not recorded"} · Genotype {p.genotype ?? "not recorded"}
          </p>
        </div>
      </div>
      {access.pending.length ? (
        <Banner tone="warn" icon="key">
          <b>
            {access.pending.length} {access.pending.length === 1 ? "practitioner is" : "practitioners are"} waiting for your decision.
          </b>{" "}
          <Link className="link" to="/patient/access">
            Review access requests
          </Link>
        </Banner>
      ) : null}
      {timeline.admission ? (
        <Banner tone="chain" icon="bed">
          You are admitted to <b>{timeline.admission.ward}</b>, {timeline.admission.hospital}
          {timeline.admission.bed ? `, bed ${timeline.admission.bed}` : ""}, since {fmtDate(timeline.admission.admittedAt)}.
        </Banner>
      ) : null}
      <section className="card">
        <h2 className="h2" style={{ marginBottom: 16 }}>
          Timeline
        </h2>
        <Timeline data={timeline} />
      </section>
    </>
  );
}
