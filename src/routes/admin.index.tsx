import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useSession } from "~/components/session";
import { Badge, Empty, ErrorBanner, Hash, Icon, TxModal, useTx } from "~/components/ui";
import { call } from "~/lib/call";
import { roleLabel, shortHash } from "~/lib/format";
import { sendContractTx } from "~/lib/wallet";
import { confirmStaffSuspension, confirmStaffVerification, getStaffTxTarget, listStaff } from "~/server/api.functions";

export const Route = createFileRoute("/admin/")({
  loader: async () => call(listStaff()),
  component: Staff,
});

const STATUS = { ACTIVE: ["active", "Verified"], PENDING_VERIFICATION: ["pending", "Not verified"], SUSPENDED: ["danger", "Suspended"] } as const;

function Staff() {
  const { hospital, staff } = Route.useLoaderData();
  const me = useMe();
  const { chain } = useSession();
  const router = useRouter();
  const tx = useTx();
  const [filter, setFilter] = useState("all");
  const [title, setTitle] = useState("");
  const shown = staff.filter((s) => filter === "all" || s.role === filter);

  const verify = async (affiliationId: string) => {
    setTitle("Verifying the practitioner");
    await tx.run(
      async () => {
        const t = await call(getStaffTxTarget({ data: { affiliationId } }));
        return sendContractTx(chain, me.user.wallet, "verifyPractitioner", [t.wallet, t.licenseNo]);
      },
      (txHash) => call(confirmStaffVerification({ data: { affiliationId, txHash } })),
    );
    await router.invalidate();
  };
  const suspend = async (affiliationId: string) => {
    setTitle("Suspending the practitioner");
    await tx.run(
      async () => {
        const t = await call(getStaffTxTarget({ data: { affiliationId } }));
        return sendContractTx(chain, me.user.wallet, "suspendPractitioner", [t.wallet]);
      },
      (txHash) => call(confirmStaffSuspension({ data: { affiliationId, txHash } })),
    );
    await router.invalidate();
  };

  return (
    <>
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">
            {hospital.code} · {hospital.name}
          </div>
          <h1 className="h1" style={{ marginTop: 6 }}>
            Staff
          </h1>
          <p className="lede">The practitioners of your hospital. Only you can verify or suspend them, and only for this hospital. You cannot open any patient's record.</p>
        </div>
        <Link className="btn btn-primary" to="/admin/staff/new">
          <Icon name="plus" /> Add practitioner
        </Link>
      </div>
      <ErrorBanner message={tx.error} />
      <TxModal stage={tx.stage} title={title} />
      <div className="grid3">
        <div className="card tight stat">
          <b>{staff.length}</b>
          <span>Practitioners</span>
        </div>
        <div className="card tight stat">
          <b>{staff.filter((s) => s.status === "ACTIVE").length}</b>
          <span>Verified on the ledger</span>
        </div>
        <div className="card tight stat">
          <b>{staff.filter((s) => s.status !== "ACTIVE").length}</b>
          <span>Not verified or suspended</span>
        </div>
      </div>
      <section className="card">
        <div className="seg" role="group" aria-label="Filter by role" style={{ marginBottom: 12 }}>
          {[["all", "All"], ["doctor", "Doctors"], ["nurse", "Nurses"], ["lab_technician", "Laboratory"]].map(([k, label]) => (
            <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {!shown.length ? <Empty>No practitioner in this group.</Empty> : null}
        {shown.length ? (
          <div className="lhead">
            <span>Name</span>
            <span>Role</span>
            <span>Department</span>
            <span>Licence</span>
            <span>Status</span>
            <span />
          </div>
        ) : null}
        {shown.map((s) => {
          const [tone, label] = STATUS[s.status as keyof typeof STATUS] ?? ["muted", s.status];
          return (
            <div className="lrow" key={s.affiliationId}>
              <div>
                <b>{s.name}</b>
                <div className="small muted">{s.email}</div>
                {s.alsoAt.length ? <div className="small muted">Also at {s.alsoAt.join(", ")}</div> : null}
              </div>
              <div>{roleLabel[s.role]}</div>
              <div>
                {s.departmentName ?? "–"}
                {s.position ? <div className="small muted">{s.position}</div> : null}
              </div>
              <div>
                <span className="mono small">{s.licenseNo}</span>
                <div className="small muted mono">{shortHash(s.wallet)}</div>
              </div>
              <div>
                <Badge tone={tone}>{label}</Badge>
                {s.verifiedTx && s.status === "ACTIVE" ? (
                  <div style={{ marginTop: 4 }}>
                    <Hash value={s.verifiedTx} />
                  </div>
                ) : null}
              </div>
              <div>
                {s.status === "ACTIVE" ? (
                  <button className="btn btn-danger-outline" style={{ minHeight: 36, padding: "0 12px" }} disabled={tx.busy} onClick={() => suspend(s.affiliationId)}>
                    Suspend
                  </button>
                ) : (
                  <button className="btn btn-primary" style={{ minHeight: 36, padding: "0 12px" }} disabled={tx.busy} onClick={() => verify(s.affiliationId)}>
                    {s.status === "SUSPENDED" ? "Re-verify" : "Verify"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
