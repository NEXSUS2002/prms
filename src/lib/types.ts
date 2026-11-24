import type * as api from "~/server/api.functions";

/** The data a server function returns when it succeeds. */
export type Data<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

export type Timeline = Data<typeof api.getMyTimeline>;
export type TimelineRecord = Timeline["records"][number];
export type LabItem = Timeline["labs"][number];
