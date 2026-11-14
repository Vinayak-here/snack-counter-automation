import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/adapters/fakeClock.js";
import { InMemoryRefillRepository } from "../src/adapters/inMemoryRefillRepository.js";
import { DuplicateActiveRefillError, VersionConflictError } from "../src/domain/error.js";
import type { OfficeId, Refill } from "../src/domain/types.js";

function newRefill(id: string, officeId: OfficeId = "OSLO"): Omit<Refill, "version"> {
  return {
    id,
    officeId,
    status: "OPEN",
    reportedBy: "ola",
    reportedAt: new Date("2026-11-02T09:00:00Z"),
    declinedOrTimedOut: [],
  };
}

describe("InMemoryRefillRepository", () => {
  it("create stores the refill with version 1", async () => {
    const repo = new InMemoryRefillRepository();
    const r = await repo.create(newRefill("r1"));
    expect(r.version).toBe(1);
    expect((await repo.get("r1"))?.status).toBe("OPEN");
  });

  it("get returns undefined for an unknown id", async () => {
    const repo = new InMemoryRefillRepository();
    expect(await repo.get("nope")).toBeUndefined();
  });

  it("refuses a second refill for an office whose box is still empty", async () => {
    const repo = new InMemoryRefillRepository();
    await repo.create(newRefill("r1", "OSLO"));
    await expect(repo.create(newRefill("r2", "OSLO"))).rejects.toThrow(DuplicateActiveRefillError);
  });

  it("each office can have its own refill", async () => {
    const repo = new InMemoryRefillRepository();
    await repo.create(newRefill("r1", "OSLO"));
    await expect(repo.create(newRefill("r2", "BLR"))).resolves.toMatchObject({ id: "r2" });
  });

  it("allows a new refill once the previous one is purchased", async () => {
    const repo = new InMemoryRefillRepository();
    const r1 = await repo.create(newRefill("r1"));
    await repo.save({ ...r1, status: "PURCHASED" }, r1.version);
    await expect(repo.create(newRefill("r2"))).resolves.toMatchObject({ id: "r2" });
  });

  it("save with the right version bumps it by 1", async () => {
    const repo = new InMemoryRefillRepository();
    const r1 = await repo.create(newRefill("r1"));
    const saved = await repo.save({ ...r1, status: "ASSIGNED", assignee: "kari" }, 1);
    expect(saved.version).toBe(2);
  });

  it("rejects a save based on a stale version, and keeps the first writer's data", async () => {
    const repo = new InMemoryRefillRepository();
    await repo.create(newRefill("r1"));
    const copyA = (await repo.get("r1"))!;
    const copyB = (await repo.get("r1"))!;

    await repo.save({ ...copyA, status: "ACCEPTED", assignee: "kari" }, copyA.version);
    await expect(
      repo.save({ ...copyB, status: "ACCEPTED", assignee: "nils" }, copyB.version),
    ).rejects.toThrow(VersionConflictError);

    expect((await repo.get("r1"))?.assignee).toBe("kari");
  });

  it("returns copies, so changing a result doesn't change what is stored", async () => {
    const repo = new InMemoryRefillRepository();
    await repo.create(newRefill("r1"));
    const r = (await repo.get("r1"))!;
    r.status = "CANCELLED";
    r.declinedOrTimedOut.push("kari");
    const fresh = (await repo.get("r1"))!;
    expect(fresh.status).toBe("OPEN");
    expect(fresh.declinedOrTimedOut).toEqual([]);
  });

  it("listByOffice returns only that office, oldest first", async () => {
    const repo = new InMemoryRefillRepository();
    const late = { ...newRefill("late"), reportedAt: new Date("2026-11-05T09:00:00Z") };
    const r1 = await repo.create(late);
    await repo.save({ ...r1, status: "PURCHASED" }, 1);
    await repo.create(newRefill("early"));
    await repo.create(newRefill("blr", "BLR"));
    const ids = (await repo.listByOffice("OSLO")).map((r) => r.id);
    expect(ids).toEqual(["early", "late"]);
  });
});

describe("FakeClock", () => {
  it("only moves when told to", () => {
    const clock = new FakeClock("2026-11-02T09:00:00Z");
    clock.advanceMinutes(90);
    expect(clock.now()).toEqual(new Date("2026-11-02T10:30:00Z"));
    clock.advanceHours(24);
    expect(clock.now()).toEqual(new Date("2026-11-03T10:30:00Z"));
  });

  it("now() returns a copy that can't move the clock", () => {
    const clock = new FakeClock("2026-11-02T09:00:00Z");
    clock.now().setFullYear(2030);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
