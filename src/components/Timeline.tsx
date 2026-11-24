import { type ReactNode, useMemo, useState } from "react";
import { fmtDate, fmtDateTime } from "~/lib/format";
import type { LabItem, Timeline as TimelineData, TimelineRecord } from "~/lib/types";
import { Badge, Empty, Hash } from "./ui";

const TITLE: Record<string, string> = { consultation: "Consultation", observation: "Nursing observation", addendum: "Correction" };

export function parseResult(raw: string | null): { result: string; comment: string } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return { result: String(p.result ?? ""), comment: String(p.comment ?? "") };
  } catch {
    return { result: raw, comment: "" };
  }
}

export function VitalsGrid({ vitals }: { vitals: NonNullable<TimelineRecord["vitals"]> }) {
  const cells: Array<[string, string | number | null]> = [
    ["Blood pressure", vitals.blood_pressure],
    ["Temperature °C", vitals.temperature_c],
    ["Pulse /min", vitals.pulse_bpm],
    ["Resp. rate /min", vitals.respiratory_rate],
    ["SpO₂ %", vitals.spo2_percent],
  ];
  return (
    <div className="grid5" style={{ marginTop: 10 }}>
      {cells.map(([label, v]) => (
        <div className="vital" key={label}>
          <b>{v ?? "–"}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function RecordBody({ r }: { r: TimelineRecord }) {
  return (
    <>
      {r.diagnosis.length ? (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          {r.diagnosis.map((d) => (
            <span className="pill" key={d.id}>
              {d.name}
            </span>
          ))}
        </div>
      ) : null}
      {r.notes ? <p style={{ margin: "8px 0 0" }}>{r.notes}</p> : null}
      {r.vitals ? <VitalsGrid vitals={r.vitals} /> : null}
      {r.medications.length ? (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18 }} className="small">
          {r.medications.map((m, i) => (
            <li key={i}>
              <b>{m.name}</b> {[m.dose, m.frequency, m.duration].filter(Boolean).join(", ")}
              {m.ongoing ? <span className="muted"> · ongoing</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

type Entry = { at: string; kind: "record"; r: TimelineRecord } | { at: string; kind: "lab"; l: LabItem };

/**
 * The unified timeline (FR8): entries from every hospital in date order, with a hospital filter.
 * A disputed entry keeps its place and its content, is marked, and shows the correction that replaced it.
 */
export function Timeline({ data, action }: { data: TimelineData; action?: (r: TimelineRecord) => ReactNode }) {
  const [hospital, setHospital] = useState("all");
  const addenda = useMemo(() => new Map(data.records.filter((r) => r.contradictsRecordId).map((r) => [r.contradictsRecordId!, r])), [data.records]);
  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const r of data.records) {
      if (r.contradictsRecordId && data.records.some((o) => o.id === r.contradictsRecordId)) continue; // shown inside the entry it corrects
      if (hospital !== "all" && r.hospitalId !== hospital) continue;
      list.push({ at: r.timestamp, kind: "record", r });
    }
    if (hospital === "all") for (const l of data.labs) list.push({ at: l.uploadedAt ?? l.orderedAt, kind: "lab", l });
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [data, hospital]);

  return (
    <div className="stack">
      <div className="row between">
        <div className="seg" role="group" aria-label="Filter by hospital">
          <button type="button" aria-pressed={hospital === "all"} onClick={() => setHospital("all")}>
            All hospitals
          </button>
          {data.hospitals.map((h) => (
            <button type="button" key={h.id} aria-pressed={hospital === h.id} onClick={() => setHospital(h.id)}>
              {h.name}
            </button>
          ))}
        </div>
        <span className="small muted">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {!entries.length ? <Empty>No entries yet.</Empty> : null}
      <div className="tl">
        {entries.map((e, i) => {
          const last = i === entries.length - 1;
          if (e.kind === "lab") {
            const res = parseResult(e.l.result);
            return (
              <div className="tl-item" key={"lab" + e.l.id}>
                <div className="tl-rail">
                  <span className="tl-dot d-lab" />
                  {!last ? <span className="tl-line" /> : null}
                </div>
                <div className="tl-body">
                  <article className="card tight">
                    <div className="rec-meta">
                      <span>{fmtDate(e.at)}</span>
                      <span>
                        {e.l.department}, {e.l.hospital}
                      </span>
                      <span>Ordered by {e.l.orderedBy}</span>
                    </div>
                    <div className="row between">
                      <h3 className="rec-title">
                        {e.l.investigation} <span className="mono small muted">{e.l.code}</span>
                      </h3>
                      {e.l.status === "FULFILLED" ? <Badge tone="chain">Laboratory result</Badge> : e.l.status === "EXPIRED" ? <Badge>Token expired</Badge> : <Badge tone="pending">Result awaited</Badge>}
                    </div>
                    {res ? (
                      <>
                        <div className="result-text">{res.result}</div>
                        {res.comment ? <p className="small" style={{ margin: "6px 0 0" }}>{res.comment}</p> : null}
                      </>
                    ) : e.l.sealed ? (
                      <p className="small muted" style={{ margin: 0 }}>
                        The result is encrypted for the ordering physician.
                      </p>
                    ) : null}
                    {e.l.txHash ? (
                      <div style={{ marginTop: 8 }}>
                        <Hash value={e.l.txHash} label="anchored" />
                      </div>
                    ) : null}
                  </article>
                </div>
              </div>
            );
          }
          const r = e.r;
          const disputed = r.status === "DISPUTED";
          const fix = addenda.get(r.id);
          return (
            <div className="tl-item" key={r.id}>
              <div className="tl-rail">
                <span className={`tl-dot ${disputed ? "d-danger" : r.type === "observation" ? "d-obs" : ""}`} />
                {!last ? <span className="tl-line" /> : null}
              </div>
              <div className="tl-body">
                <article className={`card tight ${disputed ? "disputed" : ""}`}>
                  <div className="rec-meta">
                    <span>{fmtDateTime(r.timestamp)}</span>
                    <span>
                      {r.hospital}, {r.city}
                    </span>
                    <span>{r.author}</span>
                  </div>
                  <div className="row between">
                    <h3 className="rec-title">{TITLE[r.type] ?? r.type}</h3>
                    <div className="row" style={{ gap: 6 }}>
                      {disputed ? <Badge tone="danger">Disputed</Badge> : null}
                      {r.type === "addendum" ? <Badge tone="chain">Addendum</Badge> : null}
                      {action && !disputed ? action(r) : null}
                    </div>
                  </div>
                  <RecordBody r={r} />
                  <div style={{ marginTop: 10 }}>
                    <Hash value={r.txHash} label="anchored" />
                  </div>
                  {fix ? (
                    <div className="nested">
                      <div className="rec-meta">
                        <span>Corrected {fmtDateTime(fix.timestamp)}</span>
                        <span>
                          {fix.hospital}, {fix.city}
                        </span>
                        <span>{fix.author}</span>
                      </div>
                      <div className="row between">
                        <h4 className="h3" style={{ margin: "6px 0 2px" }}>
                          Correction (addendum)
                        </h4>
                        <Badge tone="chain">Replaces the entry above</Badge>
                      </div>
                      <RecordBody r={fix} />
                      <div style={{ marginTop: 8 }}>
                        <Hash value={fix.txHash} label="anchored" />
                      </div>
                    </div>
                  ) : null}
                </article>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
