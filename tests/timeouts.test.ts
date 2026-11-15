import { describe, expect, it } from "vitest";
import { InMemoryVolunteerDirectory } from "../src/adapters/inMemoryVolunteerDirectory.js";
import { money } from "../src/domain/money.js";
import { DEFAULT_TIMEOUTS, overdueKind } from "../src/domain/timeouts.js";
import type { Refill, Volunteer } from "../src/domain/types.js";
import { AssignmentService } from "../src/services/assignmentService.js";
import { TimeoutService } from "../src/services/timeoutService.js";
import { receipt, setup } from "./helpers.js";

function person(employeeId: string, extra: Partial<Volunteer> = {}): Volunteer {
  return { employeeId, name: employeeId, homeOffice: "OSLO", currentOffice: "OSLO", presence: "IN_OFFICE", active: true, ...extra };
}

function world(people: Volunteer[]) {
  const base = setup();
  const directory = new InMemoryVolunteerDirectory(people);
  const assigner = new AssignmentService(base.service, base.repo, directory, base.clock);
  const timeouts = new TimeoutService(base.service, assigner, base.repo, base.clock); // 120 min to answer, 24 h to buy
  return { ...base, directory, assigner, timeouts };
}

describe("overdueKind (pure rule)", () => {
  const at = new Date("2026-11-02T09:00:00Z");
  const base: Refill = {
    id: "r", officeId: "OSLO", status: "ASSIGNED", version: 2, reportedBy: "x",
    reportedAt: at, assignee: "kari", assignedAt: at, declinedOrTimedOut: [],
  };
  const plus = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

  it("ASSIGNED is overdue from exactly 120 minutes", () => {
    expect(overdueKind(base, plus(119), DEFAULT_TIMEOUTS)).toBeNull();
    expect(overdueKind(base, plus(120), DEFAULT_TIMEOUTS)).toBe("ASSIGNED");
  });

  it("ACCEPTED is overdue from exactly 24 hours after accepting", () => {
    const accepted: Refill = { ...base, status: "ACCEPTED", acceptedAt: at };
    expect(overdueKind(accepted, plus(24 * 60 - 1), DEFAULT_TIMEOUTS)).toBeNull();
    expect(overdueKind(accepted, plus(24 * 60), DEFAULT_TIMEOUTS)).toBe("ACCEPTED");
  });

  it("OPEN and PURCHASED never time out", () => {
    expect(overdueKind({ ...base, status: "OPEN" }, plus(10_000), DEFAULT_TIMEOUTS)).toBeNull();
    expect(overdueKind({ ...base, status: "PURCHASED" }, plus(10_000), DEFAULT_TIMEOUTS)).toBeNull();
  });
});

describe("a refill nobody completes is handed to someone else", () => {
  it("no answer within 2 hours: the next person is asked", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(refill.assignee).toBe("kari");

    w.clock.advanceMinutes(121);
    const outcomes = await w.timeouts.checkTimeouts();

    expect(outcomes).toEqual([{ refillId: refill.id, timedOut: "kari", reassignedTo: "nils" }]);
    const now = await w.service.get(refill.id);
    expect(now.status).toBe("ASSIGNED");
    expect(now.assignee).toBe("nils");
    expect(now.declinedOrTimedOut).toEqual(["kari"]);
  });

  it("accepted but not bought within 24 hours: reassigned", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    await w.service.accept(refill.id, "kari");

    w.clock.advanceHours(25);
    const outcomes = await w.timeouts.checkTimeouts();

    expect(outcomes).toEqual([{ refillId: refill.id, timedOut: "kari", reassignedTo: "nils" }]);
  });

  it("before the limit, nothing happens", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    w.clock.advanceMinutes(90);
    expect(await w.timeouts.checkTimeouts()).toEqual([]);
    expect((await w.service.get(refill.id)).assignee).toBe("kari");
  });

  it("accepting just in time restarts the clock: now they have 24 hours to buy", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    w.clock.advanceMinutes(119);
    await w.service.accept(refill.id, "kari");
    w.clock.advanceMinutes(10); // 129 min after assignment, but only 10 after accepting
    expect(await w.timeouts.checkTimeouts()).toEqual([]);
  });

  it("someone who timed out is not asked again for that refill", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    w.clock.advanceMinutes(121);
    await w.timeouts.checkTimeouts(); // kari -> nils
    w.clock.advanceMinutes(121);
    const outcomes = await w.timeouts.checkTimeouts(); // nils times out too; kari is excluded

    expect(outcomes).toEqual([{ refillId: refill.id, timedOut: "nils", reassignedTo: null }]);
    const now = await w.service.get(refill.id);
    expect(now.status).toBe("OPEN");
    expect(now.declinedOrTimedOut).toEqual(["kari", "nils"]);
  });

  it("an OPEN refill nobody could take is retried when someone arrives", async () => {
    const w = world([person("kari", { presence: "REMOTE" })]);
    const { refill, assignedTo } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(assignedTo).toBeNull();

    w.directory.update("kari", { presence: "IN_OFFICE" });
    w.clock.advanceMinutes(5);
    const outcomes = await w.timeouts.checkTimeouts();
    expect(outcomes).toEqual([{ refillId: refill.id, reassignedTo: "kari" }]);
  });

  it("purchased refills are left alone however old they are", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    await w.service.accept(refill.id, "kari");
    await w.service.recordPurchase(refill.id, "kari", { amount: money(400, "NOK"), items: [], receiptUrl: receipt });
    w.clock.advanceHours(24 * 30);
    expect(await w.timeouts.checkTimeouts()).toEqual([]);
  });
});

describe("timeout vs last-second action", () => {
  it("expire does nothing if the person accepted after the check started", async () => {
    const w = world([person("kari")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    w.clock.advanceMinutes(121);
    await w.service.accept(refill.id, "kari"); // lands just before the timeout's write

    const after = await w.service.expire(refill.id, "kari", "ASSIGNED");
    expect(after.status).toBe("ACCEPTED");
    expect(after.assignee).toBe("kari");
    expect(after.declinedOrTimedOut).toEqual([]);
  });

  it("an accept racing the timeout check: the late yes wins and the timeout backs off", async () => {
    const w = world([person("kari"), person("nils")]);
    const { refill } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    w.clock.advanceMinutes(121);

    // The check reads kari as overdue, but her accept is saved before the
    // check's write. expire() re-reads, sees ACCEPTED, and changes nothing.
    const [check, accept] = await Promise.allSettled([
      w.timeouts.checkTimeouts(),
      w.service.accept(refill.id, "kari"),
    ]);

    expect(accept.status).toBe("fulfilled");
    expect(check).toEqual({ status: "fulfilled", value: [] });
    const final = await w.service.get(refill.id);
    expect(final.status).toBe("ACCEPTED");
    expect(final.assignee).toBe("kari");
    expect(final.declinedOrTimedOut).toEqual([]); // nils was never asked
  });
});
