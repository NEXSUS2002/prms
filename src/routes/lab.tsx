import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/lab")({
  beforeLoad: ({ context }) => requireRole(context.session, "lab_technician"),
  component: () => (
    <Shell
      nav={[
        { to: "/lab", label: "Work queue", icon: "list", exact: true },
        { to: "/lab/history", label: "History", icon: "clock" },
      ]}
    />
  ),
});
