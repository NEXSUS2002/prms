import type { ReactNode } from "react";
import { Icon } from "./ui";

export function AuthLayout({ headline, points, children, wide }: { headline: string; points?: Array<{ title: string; text: string; tag?: string }>; children: ReactNode; wide?: boolean }) {
  return (
    <div className="vp">
      <div className="auth">
        <section className="auth-art">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="plus" />
            </span>
            PRMS
          </div>
          <p className="big">{headline}</p>
          <ol className="extra stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {(points ?? []).map((p) => (
              <li key={p.title} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                {p.tag ? (
                  <span className="badge" style={{ color: "#fff", borderColor: "rgba(255,255,255,.4)" }}>
                    {p.tag}
                  </span>
                ) : null}
                <span style={{ flex: 1 }}>
                  <b style={{ color: "#fff" }}>{p.title}</b>
                  <br />
                  {p.text}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="auth-form" style={wide ? { maxWidth: 600 } : undefined}>
          {children}
        </section>
      </div>
    </div>
  );
}
