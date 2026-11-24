import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/doctor")({
  beforeLoad: ({ context }) => requireRole(context.session, "doctor"),
  component: () => (
    <Shell
      nav={[
        { to: "/doctor", label: "Home", icon: "home", exact: true },
        { to: "/doctor/patients", label: "Patients", icon: "search" },
        { to: "/doctor/orders", label: "Lab orders", icon: "flask" },
      ]}
    />
  ),
});
