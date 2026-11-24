const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDate = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso)) : "");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${DATE.format(new Date(iso))}, ${TIME.format(new Date(iso))}` : "");
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");

export function age(dateOfBirth: string): number {
  const d = new Date(dateOfBirth);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}

/** "in 5 hours", "in 12 days", "expired" */
export function until(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = ms / 3600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `in ${Math.round(h)} hours`;
  return `in ${Math.round(h / 24)} days`;
}

export const initials = (name: string) =>
  name.replace(/^(Dr|Nurse)\s+/i, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export const roleLabel: Record<string, string> = {
  patient: "Patient", doctor: "Doctor", nurse: "Nurse", lab_technician: "Laboratory technician",
  hospital_admin: "Hospital admin", registrar: "Platform registrar",
};

export const homeFor: Record<string, string> = {
  patient: "/patient", doctor: "/doctor", nurse: "/nurse", lab_technician: "/lab", hospital_admin: "/admin", registrar: "/registrar",
};
