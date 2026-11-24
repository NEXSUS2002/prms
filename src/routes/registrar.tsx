import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/registrar")({
  beforeLoad: ({ context }) => requireRole(context.session, "registrar"),
  component: () => <Shell nav={[{ to: "/registrar", label: "Hospitals", icon: "hospital" }]} />,
});
