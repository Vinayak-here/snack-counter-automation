import { describe, expect, it } from "vitest";
import { FakeChat } from "../src/adapters/fakeChat.js";
import { FakeHr } from "../src/adapters/fakeHr.js";
import { InMemoryVolunteerDirectory } from "../src/adapters/inMemoryVolunteerDirectory.js";
import { money } from "../src/domain/money.js";
import type { Volunteer } from "../src/domain/types.js";
import { AssignmentService } from "../src/services/assignmentService.js";
import { BudgetService } from "../src/services/budgetService.js";
import { SnackWorkflow } from "../src/services/snackWorkflow.js";
import { TimeoutService } from "../src/services/timeoutService.js";
import { OFFICES, receipt, setup } from "./helpers.js";

function person(employeeId: string, extra: Partial<Volunteer> = {}): Volunteer {
  return { employeeId, name: employeeId, homeOffice: "OSLO", currentOffice: "OSLO", presence: "IN_OFFICE", active: true, ...extra };
}

/** The whole system wired together with fakes, like main() would in production. */
function system(people: Volunteer[]) {
  const { repo, clock, service } = setup();
  const directory = new InMemoryVolunteerDirectory(people);
  const assigner = new AssignmentService(service, repo, directory, clock);
  const timeouts = new TimeoutService(service, assigner, repo, clock);
  const budgets = new BudgetService(repo, OFFICES, clock);
  const chat = new FakeChat();
  const hr = new FakeHr();
  const app = new SnackWorkflow(service, assigner, timeouts, budgets, repo, OFFICES, chat, hr);
  return { app, service, repo, clock, directory, chat, hr };
}

describe("from empty to reimbursed, through chat and HR", () => {
  it("the happy path", async () => {
    const s = system([person("kari"), person("nils", { presence: "REMOTE" })]);

    const refill = await s.app.reportEmpty("OSLO", "ola");
    expect(s.chat.inboxOf("kari")[0]).toContain("Budget left this month: 6000.00 NOK");

    await s.app.accept(refill.id, "kari");
    expect(s.chat.channelOf("OSLO")).toContain("kari is buying snacks. No need for anyone else to go.");

    const bought = await s.app.recordPurchase(refill.id, "kari", {
      amount: money(450.5, "NOK"),
      items: ["chips", "chocolate"],
      receiptUrl: receipt,
    });
    expect(bought.status).toBe("CLAIM_SUBMITTED");

    // HR got everything it needs: amount, currency, description, receipt, employee id
    const claim = s.hr.claims.get(bought.hrClaimId!)!;
    expect(claim.request).toEqual({
      idempotencyKey: refill.id,
      employeeId: "kari",
      amount: money(450.5, "NOK"),
      description: "Office snacks, Oslo: chips, chocolate",
      receiptUrl: receipt,
    });

    s.clock.advanceHours(24 * 4); // HR takes a few days
    await s.app.syncClaims();
    expect((await s.service.get(refill.id)).status).toBe("CLAIM_SUBMITTED"); // still pending

    s.hr.approve(bought.hrClaimId!);
    await s.app.syncClaims();
    const done = await s.service.get(refill.id);
    expect(done.status).toBe("REIMBURSED");
    expect(s.chat.inboxOf("kari").at(-1)).toContain("HR approved your snack claim of 450.50 NOK");
  });

  it("HR rejects: the refill ends CLAIM_REJECTED and the buyer is told why", async () => {
    const s = system([person("kari")]);
    const refill = await s.app.reportEmpty("OSLO", "ola");
    await s.app.accept(refill.id, "kari");
    const bought = await s.app.recordPurchase(refill.id, "kari", { amount: money(300, "NOK"), items: [], receiptUrl: receipt });

    s.hr.reject(bought.hrClaimId!, "Receipt is unreadable");
    await s.app.syncClaims();

    const r = await s.service.get(refill.id);
    expect(r.status).toBe("CLAIM_REJECTED");
    expect(r.rejectionReason).toBe("Receipt is unreadable");
    expect(s.chat.inboxOf("kari").at(-1)).toContain("Receipt is unreadable");
  });
});

describe("chat messages along the way", () => {
  it("reporting an already-handled box tells the reporter who's on it", async () => {
    const s = system([person("kari")]);
    await s.app.reportEmpty("OSLO", "ola");
    await s.app.reportEmpty("OSLO", "nils");
    expect(s.chat.inboxOf("nils")).toEqual(["Thanks! Already reported: kari is on it."]);
    expect(s.chat.inboxOf("kari")).toHaveLength(1); // not asked twice
  });

  it("nobody available: the whole office channel is asked", async () => {
    const s = system([person("kari", { presence: "HOLIDAY" })]);
    await s.app.reportEmpty("OSLO", "ola");
    expect(s.chat.channelOf("OSLO")[0]).toContain("nobody on the rota is available");
  });

  it("a decline goes straight to the next person", async () => {
    const s = system([person("kari"), person("nils")]);
    const refill = await s.app.reportEmpty("OSLO", "ola");
    await s.app.decline(refill.id, "kari");
    expect(s.chat.inboxOf("nils")[0]).toContain("Can you buy snacks today?");
  });

  it("a timeout tells the old assignee and asks the new one", async () => {
    const s = system([person("kari"), person("nils")]);
    await s.app.reportEmpty("OSLO", "ola");
    s.clock.advanceMinutes(121);
    await s.app.runTimeouts();
    expect(s.chat.inboxOf("kari").at(-1)).toContain("passed this snack run to someone else");
    expect(s.chat.inboxOf("nils")[0]).toContain("Can you buy snacks today?");
  });

  it("an over-budget purchase is flagged in the office channel", async () => {
    const s = system([person("kari")]);
    const refill = await s.app.reportEmpty("OSLO", "ola");
    await s.app.accept(refill.id, "kari");
    await s.app.recordPurchase(refill.id, "kari", { amount: money(6500, "NOK"), items: [], receiptUrl: receipt });
    expect(s.chat.channelOf("OSLO").at(-1)).toContain("over this month's snack budget");
  });
});

describe("when HR is down", () => {
  it("the purchase is kept, and the claim is sent on the next sync, exactly once", async () => {
    const s = system([person("kari")]);
    const refill = await s.app.reportEmpty("OSLO", "ola");
    await s.app.accept(refill.id, "kari");

    s.hr.failNextSubmit();
    const bought = await s.app.recordPurchase(refill.id, "kari", { amount: money(400, "NOK"), items: [], receiptUrl: receipt });
    expect(bought.status).toBe("PURCHASED"); // saved, claim not sent yet
    expect(s.hr.claims.size).toBe(0);

    await s.app.syncClaims();
    await s.app.syncClaims(); // running it again is harmless
    expect((await s.service.get(refill.id)).status).toBe("CLAIM_SUBMITTED");
    expect(s.hr.claims.size).toBe(1);
  });

  it("the same idempotency key never creates a second HR claim", async () => {
    const hr = new FakeHr();
    const req = { idempotencyKey: "refill-1", employeeId: "kari", amount: money(1, "NOK"), description: "x", receiptUrl: "r" };
    const a = await hr.submitClaim(req);
    const b = await hr.submitClaim(req);
    expect(a.claimId).toBe(b.claimId);
    expect(hr.claims.size).toBe(1);
  });
});
