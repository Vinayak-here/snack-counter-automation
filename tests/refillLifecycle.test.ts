import { describe, expect, it } from "vitest";
import {
  AlreadyAskedError,
  InvalidTransitionError,
  NotAssigneeError,
  RefillAlreadyTakenError,
  ValidationError,
  VersionConflictError,
} from "../src/domain/error.js";
import { CurrencyMismatchError, money } from "../src/domain/money.js";
import { receipt, setup } from "./helpers.js";

describe("reporting an empty box", () => {
  it("creates an OPEN refill", async () => {
    const { service } = setup();
    const { refill, created } = await service.reportEmpty("OSLO", "ola");
    expect(created).toBe(true);
    expect(refill.status).toBe("OPEN");
    expect(refill.version).toBe(1);
  });

  it("reporting again returns the same refill instead of a duplicate", async () => {
    const { service } = setup();
    const first = await service.reportEmpty("OSLO", "ola");
    const second = await service.reportEmpty("OSLO", "kari");
    expect(second.created).toBe(false);
    expect(second.refill.id).toBe(first.refill.id);
  });

  it("two simultaneous reports create only one refill", async () => {
    const { service, repo } = setup();
    const [a, b] = await Promise.all([
      service.reportEmpty("OSLO", "ola"),
      service.reportEmpty("OSLO", "kari"),
    ]);
    expect(a.refill.id).toBe(b.refill.id);
    expect(await repo.listByOffice("OSLO")).toHaveLength(1);
  });

  it("each office has its own refill", async () => {
    const { service } = setup();
    const oslo = await service.reportEmpty("OSLO", "ola");
    const blr = await service.reportEmpty("BLR", "priya");
    expect(oslo.refill.id).not.toBe(blr.refill.id);
  });

  it("once snacks are bought, a new empty report starts a new refill", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.accept(refill.id, "kari");
    await service.recordPurchase(refill.id, "kari", { amount: money(500, "NOK"), items: ["chips"], receiptUrl: receipt });

    const next = await service.reportEmpty("OSLO", "ola");
    expect(next.created).toBe(true);
    expect(next.refill.id).not.toBe(refill.id);
  });
});

describe("full lifecycle", () => {
  it("goes from OPEN all the way to REIMBURSED", async () => {
    const { service, clock } = setup();
    const { refill } = await service.reportEmpty("BLR", "priya");

    await service.assign(refill.id, "arjun");
    clock.advanceMinutes(10);
    await service.accept(refill.id, "arjun");
    clock.advanceHours(3);
    await service.recordPurchase(refill.id, "arjun", {
      amount: money(1250.5, "INR"),
      items: ["Parle-G", "bhujia"],
      receiptUrl: receipt,
    });
    await service.markClaimSubmitted(refill.id, "hr-42");
    const done = await service.markReimbursed(refill.id);

    expect(done.status).toBe("REIMBURSED");
    expect(done.purchase?.amount.amountMinor).toBe(125050);
    expect(done.purchase?.items).toEqual(["Parle-G", "bhujia"]);
    expect(done.hrClaimId).toBe("hr-42");
    expect(done.acceptedAt).toEqual(new Date("2026-11-02T09:10:00Z"));
    expect(done.version).toBe(6); // created (1) + 5 saves
  });

  it("records the reason when HR rejects the claim", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.accept(refill.id, "ola");
    await service.recordPurchase(refill.id, "ola", { amount: money(300, "NOK"), items: [], receiptUrl: receipt });
    await service.markClaimSubmitted(refill.id, "hr-1");
    const rejected = await service.markClaimRejected(refill.id, "Receipt unreadable");
    expect(rejected.status).toBe("CLAIM_REJECTED");
    expect(rejected.rejectionReason).toBe("Receipt unreadable");
  });
});

describe("two people can't both commit to the same refill", () => {
  it("when two accepts race, exactly one wins", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");

    // Both messages arrive "at the same time".
    const results = await Promise.allSettled([
      service.accept(refill.id, "kari"),
      service.accept(refill.id, "nils"),
    ]);

    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason).toBeInstanceOf(RefillAlreadyTakenError);

    const final = await service.get(refill.id);
    expect(final.status).toBe("ACCEPTED");
    expect(["kari", "nils"]).toContain(final.assignee);
  });

  it("storage rejects a save based on a stale version", async () => {
    const { service, repo } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");

    const copyA = (await repo.get(refill.id))!;
    const copyB = (await repo.get(refill.id))!;
    await repo.save({ ...copyA, status: "ACCEPTED", assignee: "kari" }, copyA.version);

    await expect(
      repo.save({ ...copyB, status: "ACCEPTED", assignee: "nils" }, copyB.version),
    ).rejects.toThrow(VersionConflictError);
    expect((await repo.get(refill.id))!.assignee).toBe("kari");
  });

  it("someone can volunteer while another person is only assigned", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.assign(refill.id, "kari");
    const taken = await service.accept(refill.id, "nils");
    expect(taken.assignee).toBe("nils");
    await expect(service.accept(refill.id, "kari")).rejects.toThrow(RefillAlreadyTakenError);
  });

  it("accepting twice is harmless for the same person", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    const first = await service.accept(refill.id, "kari");
    const second = await service.accept(refill.id, "kari");
    expect(second.version).toBe(first.version); // nothing was saved
  });
});

describe("declining", () => {
  it("sends the refill back to OPEN and remembers who declined", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.assign(refill.id, "kari");
    const back = await service.decline(refill.id, "kari");

    expect(back.status).toBe("OPEN");
    expect(back.assignee).toBeUndefined();
    expect(back.declinedOrTimedOut).toEqual(["kari"]);
    await expect(service.assign(refill.id, "kari")).rejects.toThrow(AlreadyAskedError);
  });

  it("only the assignee can decline", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.assign(refill.id, "kari");
    await expect(service.decline(refill.id, "nils")).rejects.toThrow(NotAssigneeError);
  });
});

describe("guard rails", () => {
  it("can't record a purchase before anyone accepted", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await expect(
      service.recordPurchase(refill.id, "ola", { amount: money(300, "NOK"), items: [], receiptUrl: receipt }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("only the person who accepted can record the purchase", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.accept(refill.id, "kari");
    await expect(
      service.recordPurchase(refill.id, "nils", { amount: money(300, "NOK"), items: [], receiptUrl: receipt }),
    ).rejects.toThrow(NotAssigneeError);
  });

  it("purchase must be in the office's currency", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.accept(refill.id, "kari");
    await expect(
      service.recordPurchase(refill.id, "kari", { amount: money(300, "INR"), items: [], receiptUrl: receipt }),
    ).rejects.toThrow(CurrencyMismatchError);
  });

  it("purchase needs a positive amount and a receipt", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.accept(refill.id, "kari");
    await expect(
      service.recordPurchase(refill.id, "kari", { amount: money(0, "NOK"), items: [], receiptUrl: receipt }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.recordPurchase(refill.id, "kari", { amount: money(300, "NOK"), items: [], receiptUrl: " " }),
    ).rejects.toThrow(ValidationError);
  });

  it("a cancelled refill can't be accepted", async () => {
    const { service } = setup();
    const { refill } = await service.reportEmpty("OSLO", "ola");
    await service.cancel(refill.id);
    await expect(service.accept(refill.id, "kari")).rejects.toThrow(InvalidTransitionError);
  });
});
