import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "~/components/Shell";
import { requireRole } from "~/lib/guard";

export const Route = createFileRoute("/nurse")({
  beforeLoad: ({ context }) => requireRole(context.session, "nurse"),
  component: () => <Shell nav={[{ to: "/nurse", label: "Ward", icon: "bed" }]} />,
});
