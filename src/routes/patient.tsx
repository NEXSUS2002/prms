import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/patient")({
  beforeLoad: ({ context }) => requireRole(context.session, "patient"),
  component: () => (
    <Shell
      nav={[
        { to: "/patient", label: "Timeline", icon: "timeline", exact: true },
        { to: "/patient/access", label: "Access", icon: "key" },
        { to: "/patient/audit", label: "Audit log", icon: "shield" },
      ]}
    />
  ),
});
