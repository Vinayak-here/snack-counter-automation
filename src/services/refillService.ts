import { randomUUID } from "node:crypto";
import {
  AlreadyAskedError,
  BudgetExceededError,
  DuplicateActiveRefillError,
  NotAssigneeError,
  RefillAlreadyTakenError,
  RefillNotFoundError,
  ValidationError,
  VersionConflictError,
} from "../domain/error.js";
import { budgetStatus, type OverBudgetPolicy } from "../domain/budget.js";
import { CurrencyMismatchError, format, isGreaterThan, type Money } from "../domain/money.js";
import { assertTransition } from "../domain/refillStateMachine.js";
import type { Office, OfficeId, Refill } from "../domain/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { RefillRepository } from "../ports/refillRepository.js";

export interface PurchaseInput {
  amount: Money; // must be in the office's currency
  items: string[];
  receiptUrl: string;
}

export interface ReportResult {
  refill: Refill;
  /** false = the box was already reported; this is the existing refill. */
  created: boolean;
}

/** How many times to retry when someone else saved the refill first. */
const MAX_ATTEMPTS = 3;

/**
 * Use-cases for one refill's life: report empty -> assign -> accept ->
 * purchase -> claim -> reimbursed. Every change goes through `update`,
 * which checks the state machine and uses optimistic locking.
 */
export class RefillService {
  constructor(
    private readonly repo: RefillRepository,
    private readonly offices: Record<OfficeId, Office>,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID,
    private readonly overBudgetPolicy: OverBudgetPolicy = "FLAG",
  ) {}

  /**
   * Anyone can say "the box is empty". If a refill for that office is
   * already waiting for a purchase, return it instead of making a second one.
   */
  async reportEmpty(officeId: OfficeId, reportedBy: string): Promise<ReportResult> {
    const existing = await this.repo.findAwaitingPurchase(officeId);
    if (existing) return { refill: existing, created: false };

    try {
      const refill = await this.repo.create({
        id: this.newId(),
        officeId,
        status: "OPEN",
        reportedBy,
        reportedAt: this.clock.now(),
        declinedOrTimedOut: [],
      });
      return { refill, created: true };
    } catch (err) {
      // Two people reported at the same moment and the other one won the
      // race to create. Not an error for the user: return their refill.
      if (err instanceof DuplicateActiveRefillError) {
        const winner = await this.repo.findAwaitingPurchase(officeId);
        if (winner) return { refill: winner, created: false };
      }
      throw err;
    }
  }

  /** The system asks one person to buy (who is chosen in Phase 3). */
  async assign(refillId: string, employeeId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      assertTransition(r.status, "ASSIGNED");
      if (r.declinedOrTimedOut.includes(employeeId)) {
        throw new AlreadyAskedError(r.id, employeeId);
      }
      return { ...r, status: "ASSIGNED", assignee: employeeId, assignedAt: this.clock.now() };
    });
  }

  /**
   * "I'll buy it." Works for the assignee, and also for anyone who
   * volunteers while the refill is OPEN or ASSIGNED: first to commit wins.
   * Saying yes twice is harmless (idempotent), but a second person gets
   * RefillAlreadyTakenError.
   */
  async accept(refillId: string, employeeId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      if (r.status === "ACCEPTED") {
        if (r.assignee === employeeId) return null; // already theirs, nothing to change
        throw new RefillAlreadyTakenError(r.id, r.assignee ?? "someone");
      }
      assertTransition(r.status, "ACCEPTED");
      const now = this.clock.now();
      return {
        ...r,
        status: "ACCEPTED",
        assignee: employeeId,
        assignedAt: r.assignee === employeeId ? r.assignedAt : now,
        acceptedAt: now,
      };
    });
  }

  /**
   * The current assignee says no (or backs out after accepting). The refill
   * goes back to OPEN and they won't be asked again for this refill.
   */
  async decline(refillId: string, employeeId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      if (r.assignee !== employeeId) throw new NotAssigneeError(r.id, employeeId);
      return this.backToOpen(r, employeeId);
    });
  }

  /**
   * Time ran out for the current assignee (Phase 4). Same effect as a decline,
   * but only if the refill is STILL in `expectedStatus` with that assignee.
   * If they accepted or bought at the last second, nothing happens:
   * the timeout lost the race, and that's the right outcome.
   */
  async expire(refillId: string, employeeId: string, expectedStatus: "ASSIGNED" | "ACCEPTED"): Promise<Refill> {
    return this.update(refillId, (r) => {
      if (r.status !== expectedStatus || r.assignee !== employeeId) return null; // moved on, leave it
      return this.backToOpen(r, employeeId);
    });
  }

  /** Shared by decline and expire: back to OPEN, and never ask this person again for this refill. */
  private backToOpen(r: Refill, employeeId: string): Refill {
    assertTransition(r.status, "OPEN");
    return {
      ...r,
      status: "OPEN",
      assignee: undefined,
      assignedAt: undefined,
      acceptedAt: undefined,
      declinedOrTimedOut: [...r.declinedOrTimedOut, employeeId],
    };
  }

  /**
   * The person who accepted has bought the snacks and uploaded a receipt.
   * Budget (Phase 5): the money is already spent, so by default an
   * over-budget purchase is recorded and flagged for approval ("FLAG").
   * With "BLOCK" it is refused instead.
   */
  async recordPurchase(refillId: string, employeeId: string, input: PurchaseInput): Promise<Refill> {
    if (input.amount.amountMinor <= 0) throw new ValidationError("Purchase amount must be positive");
    if (input.receiptUrl.trim() === "") throw new ValidationError("A receipt is required for the HR claim");

    // This month's spend so far. Safe to read outside update(): only one
    // refill per office can be awaiting purchase, so no other purchase for
    // this office can land in between.
    const { officeId } = await this.get(refillId);
    const office = this.offices[officeId];
    const budget = budgetStatus(office, await this.repo.listByOffice(officeId), this.clock.now());

    return this.update(refillId, (r) => {
      assertTransition(r.status, "PURCHASED");
      if (r.assignee !== employeeId) throw new NotAssigneeError(r.id, employeeId);
      if (input.amount.currency !== office.currency) {
        throw new CurrencyMismatchError(input.amount.currency, office.currency);
      }
      const overBudget = isGreaterThan(input.amount, budget.remaining);
      if (overBudget && this.overBudgetPolicy === "BLOCK") {
        throw new BudgetExceededError(r.officeId, format(budget.remaining), format(input.amount));
      }
      return {
        ...r,
        status: "PURCHASED",
        purchase: {
          amount: input.amount,
          items: [...input.items],
          receiptUrl: input.receiptUrl,
          purchasedAt: this.clock.now(),
          overBudget,
        },
      };
    });
  }

  async markClaimSubmitted(refillId: string, hrClaimId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      assertTransition(r.status, "CLAIM_SUBMITTED");
      return { ...r, status: "CLAIM_SUBMITTED", hrClaimId };
    });
  }

  async markReimbursed(refillId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      assertTransition(r.status, "REIMBURSED");
      return { ...r, status: "REIMBURSED", reimbursedAt: this.clock.now() };
    });
  }

  async markClaimRejected(refillId: string, reason: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      assertTransition(r.status, "CLAIM_REJECTED");
      return { ...r, status: "CLAIM_REJECTED", rejectionReason: reason };
    });
  }

  async cancel(refillId: string): Promise<Refill> {
    return this.update(refillId, (r) => {
      assertTransition(r.status, "CANCELLED");
      return { ...r, status: "CANCELLED" };
    });
  }

  async get(refillId: string): Promise<Refill> {
    const r = await this.repo.get(refillId);
    if (!r) throw new RefillNotFoundError(refillId);
    return r;
  }

  /**
   * Read -> decide -> save, with optimistic locking.
   *
   * `change` gets the latest refill and returns the new version (or null for
   * "nothing to change"). If someone else saved in between, `save` throws
   * VersionConflictError and we run `change` again on the fresh data. That's
   * why `change` must have no side effects: it may run more than once.
   */
  private async update(
    refillId: string,
    change: (current: Refill) => Refill | null,
  ): Promise<Refill> {
    for (let attempt = 1; ; attempt++) {
      const current = await this.get(refillId);
      const next = change(current);
      if (next === null) return current;
      try {
        return await this.repo.save(next, current.version);
      } catch (err) {
        if (err instanceof VersionConflictError && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
  }
}
