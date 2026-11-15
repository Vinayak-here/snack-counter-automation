import { describe, expect, it } from "vitest";
import { money } from "../src/domain/money.js";
import { isEligible, pickNextBuyer } from "../src/domain/rotation.js";
import type { Refill, Volunteer } from "../src/domain/types.js";

const NOW = new Date("2026-11-15T09:00:00Z");

function person(employeeId: string, extra: Partial<Volunteer> = {}): Volunteer {
  return {
    employeeId,
    name: employeeId,
    homeOffice: "OSLO",
    currentOffice: "OSLO",
    presence: "IN_OFFICE",
    active: true,
    ...extra,
  };
}

/** A finished purchase by `buyer`, `daysAgo` days before NOW. */
function boughtBy(buyer: string, daysAgo: number): Refill {
  const at = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: `${buyer}-${daysAgo}`,
    officeId: "OSLO",
    status: "REIMBURSED",
    version: 5,
    reportedBy: "x",
    reportedAt: at,
    assignee: buyer,
    declinedOrTimedOut: [],
    purchase: { amount: money(400, "NOK"), items: [], receiptUrl: "r", purchasedAt: at },
  };
}

describe("isEligible", () => {
  it("needs active, in the office, and in THIS office", () => {
    expect(isEligible(person("a"), "OSLO", [])).toBe(true);
    expect(isEligible(person("a", { active: false }), "OSLO", [])).toBe(false);
    expect(isEligible(person("a", { presence: "REMOTE" }), "OSLO", [])).toBe(false);
    expect(isEligible(person("a", { presence: "HOLIDAY" }), "OSLO", [])).toBe(false);
    expect(isEligible(person("a"), "BLR", [])).toBe(false);
  });

  it("a visitor counts for the office they are in, not their home office", () => {
    const visitor = person("priya", { homeOffice: "BLR", currentOffice: "OSLO" });
    expect(isEligible(visitor, "OSLO", [])).toBe(true);
    expect(isEligible(visitor, "BLR", [])).toBe(false);
  });

  it("skips people who already declined or timed out", () => {
    expect(isEligible(person("a"), "OSLO", ["a"])).toBe(false);
  });
});

describe("pickNextBuyer", () => {
  it("picks the person with the fewest recent purchases", () => {
    const people = [person("kari"), person("nils")];
    const history = [boughtBy("kari", 3), boughtBy("kari", 10), boughtBy("nils", 5)];
    expect(pickNextBuyer(people, history, "OSLO", [], NOW)?.employeeId).toBe("nils");
  });

  it("on a tie, picks whoever bought longest ago", () => {
    const people = [person("kari"), person("nils")];
    const history = [boughtBy("kari", 2), boughtBy("nils", 9)];
    expect(pickNextBuyer(people, history, "OSLO", [], NOW)?.employeeId).toBe("nils");
  });

  it("someone who never bought goes first", () => {
    const people = [person("kari"), person("new-joiner")];
    const history = [boughtBy("kari", 25)];
    expect(pickNextBuyer(people, history, "OSLO", [], NOW)?.employeeId).toBe("new-joiner");
  });

  it("purchases older than the window don't count against you", () => {
    const people = [person("kari"), person("nils")];
    // kari bought 3 times, but over 30 days ago; nils once, last week
    const history = [boughtBy("kari", 40), boughtBy("kari", 45), boughtBy("kari", 50), boughtBy("nils", 7)];
    expect(pickNextBuyer(people, history, "OSLO", [], NOW)?.employeeId).toBe("kari");
  });

  it("returns undefined when nobody is eligible", () => {
    const people = [person("kari", { presence: "HOLIDAY" }), person("nils", { currentOffice: "BLR" })];
    expect(pickNextBuyer(people, [], "OSLO", [], NOW)).toBeUndefined();
  });

  it("is deterministic when everything else is equal", () => {
    const people = [person("nils"), person("kari")];
    expect(pickNextBuyer(people, [], "OSLO", [], NOW)?.employeeId).toBe("kari");
  });
});
