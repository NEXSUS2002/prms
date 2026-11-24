import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useSession } from "~/components/session";
import { Badge, Banner, Empty, ErrorBanner, Icon, Modal, TxModal, useAction, useTx } from "~/components/ui";
import { call } from "~/lib/call";
import { age, until } from "~/lib/format";
import type { Data } from "~/lib/types";
import { sendContractTx } from "~/lib/wallet";
import { confirmEmergencyAccess, requestAccess, searchPatients } from "~/server/api.functions";
import { keccak256, stringToBytes } from "viem";

export const Route = createFileRoute("/doctor/patients/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: typeof s.q === "string" && s.q ? s.q : undefined }),
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: async ({ deps }) => call(searchPatients({ data: { query: deps.q } })),
  component: Directory,
});

type Row = Data<typeof searchPatients>[number];

function Directory() {
  const rows = Route.useLoaderData();
  const { q = "" } = Route.useSearch();
  const me = useMe();
  const { chain } = useSession();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [text, setText] = useState(q);
  const [override, setOverride] = useState<Row | null>(null);
  const [opened, setOpened] = useState<Row | null>(null);
  const tx = useTx();
  const plain = useAction();

  const request = (p: Row) => plain.run(() => call(requestAccess({ data: { patientId: p.id } }))).then(() => router.invalidate());
  const breakGlass = async (p: Row) => {
    setOverride(null);
    const res = await tx.run(
      // The working hospital goes on the ledger with the override, as keccak256 of its id.
      () => sendContractTx(chain, me.user.wallet, "emergencyAccess", [p.wallet, keccak256(stringToBytes(me.hospitalId ?? ""))]),
      (txHash) => call(confirmEmergencyAccess({ data: { patientId: p.id, txHash } })),
    );
    if (res) setOpened(p);
    await router.invalidate();
  };

  return (
    <>
      <div>
        <h1 className="h1">Patients</h1>
        <p className="lede">Search by name or patient number. A patient's history stays hidden until the patient approves your request, or you use the emergency override.</p>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: { q: text.trim() || undefined } });
        }}
      >
        <input className="input" style={{ maxWidth: 420 }} placeholder="Name or patient number, for example PT-0004" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search patients" />
        <button className="btn btn-primary">
          <Icon name="search" /> Search
        </button>
      </form>
      <ErrorBanner message={tx.error ?? plain.error} />
      {opened ? (
        <Banner tone="danger">
          <b>Emergency access to {opened.name} is active for one hour.</b> The override is recorded on the ledger with your licence number and the patient can see it.{" "}
          <Link className="link" to="/doctor/patients/$patientId" params={{ patientId: opened.id }}>
            Open the record
          </Link>
        </Banner>
      ) : null}
      <TxModal stage={tx.stage} title="Logging the emergency override" />

      <section className="card">
        {!rows.length ? <Empty>No patient matches that search.</Empty> : null}
        <div className="stack">
          {rows.map((p, i) => (
            <div key={p.id}>
              {i ? <hr className="divider" style={{ marginBottom: 16 }} /> : null}
              <div className="row between">
                <div>
                  <div className="h3">
                    {p.name} <span className="mono small muted">{p.code}</span>
                  </div>
                  <div className="small muted">
                    {p.sex === "F" ? "Female" : "Male"}, {age(p.dateOfBirth)}
                    {p.access === "GRANTED" || p.access === "EMERGENCY" ? ` · access ends ${until(p.expiresAt)}` : ""}
                  </div>
                </div>
                <div className="row grow-sm">
                  {p.access === "GRANTED" ? <Badge tone="active">Access granted</Badge> : null}
                  {p.access === "EMERGENCY" ? <Badge tone="danger">Emergency access</Badge> : null}
                  {p.access === "PENDING" ? <Badge tone="pending">Awaiting patient</Badge> : null}
                  {p.access === "NONE" ? <Badge>History hidden</Badge> : null}
                  {p.access === "GRANTED" || p.access === "EMERGENCY" ? (
                    <Link className="btn btn-primary" to="/doctor/patients/$patientId" params={{ patientId: p.id }}>
                      Open record
                    </Link>
                  ) : (
                    <>
                      {p.access === "NONE" ? (
                        <button className="btn btn-secondary" disabled={plain.busy} onClick={() => request(p)}>
                          Request access
                        </button>
                      ) : null}
                      <button className="btn btn-danger-outline" disabled={tx.busy || !p.hasWallet} onClick={() => setOverride(p)}>
                        Emergency override
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {override ? (
        <Modal label="Emergency override">
          <div className="row" style={{ color: "var(--color-danger)" }}>
            <Icon name="warn" />
            <h2 className="h2">Emergency override</h2>
          </div>
          <p style={{ margin: 0 }}>
            You are about to open the record of <b>{override.name}</b> without the patient's consent.
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Use this only when the patient cannot consent and delay would endanger life.</li>
            <li>Access lasts one hour and then ends by itself.</li>
            <li>
              Your name, licence number <span className="mono">{me.user.licenseNo}</span> and the time are written permanently to the ledger. The patient will see it.
            </li>
          </ul>
          <div className="row grow-sm">
            <button className="btn btn-danger" onClick={() => breakGlass(override)}>
              Sign and open record
            </button>
            <button className="btn btn-secondary" onClick={() => setOverride(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
