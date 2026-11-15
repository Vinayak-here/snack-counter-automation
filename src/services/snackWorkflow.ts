import { format } from "../domain/money.js";
import type { Office, OfficeId, Refill } from "../domain/types.js";
import type { ChatPort } from "../ports/chatPort.js";
import type { HrPort } from "../ports/hrPort.js";
import type { RefillRepository } from "../ports/refillRepository.js";
import type { AssignmentService } from "./assignmentService.js";
import type { BudgetService } from "./budgetService.js";
import type { PurchaseInput, RefillService } from "./refillService.js";
import type { TimeoutService } from "./timeoutService.js";

/**
 * The outside-facing entry points: what the chat bot calls when someone
 * types something, and what the scheduler calls every few minutes.
 * It runs the use-cases, then tells people what happened through chat and HR.
 * All business rules stay in the services below it.
 */
export class SnackWorkflow {
  constructor(
    private readonly refills: RefillService,
    private readonly assigner: AssignmentService,
    private readonly timeouts: TimeoutService,
    private readonly budgets: BudgetService,
    private readonly repo: RefillRepository,
    private readonly offices: Record<OfficeId, Office>,
    private readonly chat: ChatPort,
    private readonly hr: HrPort,
  ) {}

  // ---- called by the chat bot ----

  /** "The box is empty." */
  async reportEmpty(officeId: OfficeId, reportedBy: string): Promise<Refill> {
    const existing = await this.repo.findAwaitingPurchase(officeId);
    if (existing && existing.status !== "OPEN") {
      await this.chat.sendDirect(reportedBy, `Thanks! Already reported: ${existing.assignee} is on it.`);
      return existing;
    }
    const { refill, assignedTo } = await this.assigner.reportEmptyAndAssign(officeId, reportedBy);
    await this.askOrBroadcast(refill, assignedTo);
    return refill;
  }

  /** "I'll buy it." Tells the office so nobody else buys the same day. */
  async accept(refillId: string, employeeId: string): Promise<Refill> {
    const refill = await this.refills.accept(refillId, employeeId);
    await this.chat.postToOffice(refill.officeId, `${employeeId} is buying snacks. No need for anyone else to go.`);
    return refill;
  }

  /** "Not me this time." Asks the next person straight away. */
  async decline(refillId: string, employeeId: string): Promise<Refill> {
    await this.refills.decline(refillId, employeeId);
    const { refill, assignedTo } = await this.assigner.assignNext(refillId);
    await this.askOrBroadcast(refill, assignedTo);
    return refill;
  }

  /** "Bought it, here's the receipt." Records it and sends the claim to HR right away. */
  async recordPurchase(refillId: string, employeeId: string, input: PurchaseInput): Promise<Refill> {
    const refill = await this.refills.recordPurchase(refillId, employeeId, input);
    if (refill.purchase?.overBudget) {
      await this.chat.postToOffice(
        refill.officeId,
        `Heads-up: ${format(input.amount)} by ${employeeId} takes ${this.offices[refill.officeId].name} over this month's snack budget. Needs approval.`,
      );
    }
    return this.trySubmitClaim(refill);
  }

  // ---- called on a schedule (e.g. every 5 minutes) ----

  /** Pass refills on when people don't answer or don't buy in time. */
  async runTimeouts(): Promise<void> {
    for (const o of await this.timeouts.checkTimeouts()) {
      if (o.timedOut) {
        await this.chat.sendDirect(o.timedOut, "No worries, we've passed this snack run to someone else.");
      }
      await this.askOrBroadcast(await this.refills.get(o.refillId), o.reassignedTo);
    }
  }

  /** Retry claims HR couldn't take, and pick up HR's decisions on submitted ones. */
  async syncClaims(): Promise<void> {
    for (const r of await this.repo.listAll()) {
      if (r.status === "PURCHASED") {
        await this.trySubmitClaim(r);
      } else if (r.status === "CLAIM_SUBMITTED" && r.hrClaimId) {
        const status = await this.hr.getClaimStatus(r.hrClaimId);
        if (status.state === "APPROVED") {
          await this.refills.markReimbursed(r.id);
          await this.chat.sendDirect(r.assignee!, `HR approved your snack claim of ${format(r.purchase!.amount)}. It will be in your next salary.`);
        } else if (status.state === "REJECTED") {
          await this.refills.markClaimRejected(r.id, status.reason);
          await this.chat.sendDirect(r.assignee!, `HR rejected your snack claim: ${status.reason}. Please contact HR.`);
        }
      }
    }
  }

  // ---- helpers ----

  /** Ask the chosen person, or tell the whole office nobody could be picked. */
  private async askOrBroadcast(refill: Refill, assignedTo: string | null): Promise<void> {
    const office = this.offices[refill.officeId];
    if (assignedTo) {
      const { remaining } = await this.budgets.status(refill.officeId);
      await this.chat.sendDirect(
        assignedTo,
        `The ${office.name} snack box is empty. Can you buy snacks today? Budget left this month: ${format(remaining)}. Reply "accept ${refill.id}" or "decline ${refill.id}".`,
      );
    } else {
      await this.chat.postToOffice(
        refill.officeId,
        `The snack box is empty and nobody on the rota is available. Can anyone in the office buy? Reply "accept ${refill.id}".`,
      );
    }
  }

  /**
   * Send the claim to HR. If HR is down, keep the refill PURCHASED and let
   * syncClaims() retry later. The idempotency key (the refill id) means a
   * retry after a half-finished attempt can't create a second claim.
   */
  private async trySubmitClaim(refill: Refill): Promise<Refill> {
    const purchase = refill.purchase!;
    let claimId: string;
    try {
      ({ claimId } = await this.hr.submitClaim({
        idempotencyKey: refill.id,
        employeeId: refill.assignee!,
        amount: purchase.amount,
        description: `Office snacks, ${this.offices[refill.officeId].name}: ${purchase.items.join(", ") || "snacks"}`,
        receiptUrl: purchase.receiptUrl,
      }));
    } catch {
      return refill; // stays PURCHASED; syncClaims() will retry
    }
    const submitted = await this.refills.markClaimSubmitted(refill.id, claimId);
    await this.chat.sendDirect(refill.assignee!, `Thanks for the snacks! Your claim ${claimId} is with HR (usually 1-10 days).`);
    return submitted;
  }
}
