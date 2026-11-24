import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/admin")({
  beforeLoad: ({ context }) => requireRole(context.session, "hospital_admin"),
  component: () => (
    <Shell
      nav={[
        { to: "/admin", label: "Staff", icon: "users", exact: true },
        { to: "/admin/hospital", label: "Hospital", icon: "hospital" },
      ]}
    />
  ),
});
