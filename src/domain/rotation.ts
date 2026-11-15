import type { OfficeId, Refill, Volunteer } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Can this person be asked to buy for this office right now? */
export function isEligible(v: Volunteer, officeId: OfficeId, excluded: readonly string[]): boolean {
  return (
    v.active &&
    v.presence === "IN_OFFICE" &&
    v.currentOffice === officeId && // covers visitors: it's where they ARE, not their home office
    !excluded.includes(v.employeeId)
  );
}

interface BuyerStats {
  volunteer: Volunteer;
  recentCount: number; // purchases inside the window
  lastAt: number;      // time of their latest purchase ever; -Infinity if never
}

/**
 * Fair rotation: among eligible people, pick the one with the fewest
 * purchases in the last `windowDays`. Tie-break: whoever bought longest ago
 * (never bought = longest ago). Final tie-break: employeeId, so the result
 * is always the same for the same input.
 * Returns undefined when nobody is eligible.
 */
export function pickNextBuyer(
  volunteers: readonly Volunteer[],
  refills: readonly Refill[],
  officeId: OfficeId,
  excluded: readonly string[],
  now: Date,
  windowDays = 30,
): Volunteer | undefined {
  const windowStart = now.getTime() - windowDays * DAY_MS;

  const stats: BuyerStats[] = volunteers
    .filter((v) => isEligible(v, officeId, excluded))
    .map((volunteer) => {
      const theirPurchases = refills
        .filter((r) => r.purchase && r.assignee === volunteer.employeeId)
        .map((r) => r.purchase!.purchasedAt.getTime());
      return {
        volunteer,
        recentCount: theirPurchases.filter((t) => t >= windowStart).length,
        lastAt: theirPurchases.length > 0 ? Math.max(...theirPurchases) : -Infinity,
      };
    });

  stats.sort(
    (a, b) =>
      a.recentCount - b.recentCount ||
      a.lastAt - b.lastAt ||
      a.volunteer.employeeId.localeCompare(b.volunteer.employeeId),
  );

  return stats[0]?.volunteer;
}
