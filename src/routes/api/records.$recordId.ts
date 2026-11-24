import { createFileRoute } from "@tanstack/react-router";

// FR4: a clinical record can never be deleted or overwritten. The route exists only to say so.
const refuse = () =>
  Response.json(
    { error: "Clinical records cannot be deleted or edited. Dispute the record instead; the original is kept and marked DISPUTED." },
    { status: 405, headers: { Allow: "" } },
  );

export const Route = createFileRoute("/api/records/$recordId")({
  server: { handlers: { DELETE: refuse, PUT: refuse, PATCH: refuse } },
});
