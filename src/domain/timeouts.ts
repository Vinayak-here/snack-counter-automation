import type { Refill } from "./types.js";

/** How long people get before the refill moves on. Assumed values; confirm with the business. */
export interface TimeoutPolicy {
  /** ASSIGNED: time to say yes or no. */
  respondWithinMinutes: number;
  /** ACCEPTED: time to actually buy. */
  buyWithinHours: number;
}

export const DEFAULT_TIMEOUTS: TimeoutPolicy = {
  respondWithinMinutes: 120,
  buyWithinHours: 24,
};

const MINUTE_MS = 60 * 1000;

/**
 * Has the current assignee run out of time? Pure: depends only on its inputs.
 * Returns which kind of timeout it is, or null if nothing is overdue.
 */
export function overdueKind(refill: Refill, now: Date, policy: TimeoutPolicy): "ASSIGNED" | "ACCEPTED" | null {
  const elapsedMs = (since: Date | undefined) => (since ? now.getTime() - since.getTime() : 0);

  if (refill.status === "ASSIGNED" && elapsedMs(refill.assignedAt) >= policy.respondWithinMinutes * MINUTE_MS) {
    return "ASSIGNED";
  }
  if (refill.status === "ACCEPTED" && elapsedMs(refill.acceptedAt) >= policy.buyWithinHours * 60 * MINUTE_MS) {
    return "ACCEPTED";
  }
  return null;
}
