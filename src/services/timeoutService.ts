import { isAwaitingPurchase } from "../domain/refillStateMachine.js";
import { DEFAULT_TIMEOUTS, overdueKind, type TimeoutPolicy } from "../domain/timeouts.js";
import type { Clock } from "../ports/clock.js";
import type { RefillRepository } from "../ports/refillRepository.js";
import type { AssignmentService } from "./assignmentService.js";
import type { RefillService } from "./refillService.js";

export interface TimeoutOutcome {
  refillId: string;
  /** Who ran out of time; undefined when an OPEN refill was simply retried. */
  timedOut?: string;
  /** Who was asked next; null = nobody eligible, the refill stays OPEN. */
  reassignedTo: string | null;
}

/**
 * Run this on a schedule (e.g. every 5 minutes). It finds refills whose
 * assignee ran out of time, hands them to the next person, and retries
 * OPEN refills that nobody could take earlier.
 */
export class TimeoutService {
  constructor(
    private readonly refills: RefillService,
    private readonly assigner: AssignmentService,
    private readonly repo: RefillRepository,
    private readonly clock: Clock,
    private readonly policy: TimeoutPolicy = DEFAULT_TIMEOUTS,
  ) {}

  async checkTimeouts(): Promise<TimeoutOutcome[]> {
    const now = this.clock.now();
    const waiting = (await this.repo.listAll()).filter((r) => isAwaitingPurchase(r.status));
    const outcomes: TimeoutOutcome[] = [];

    for (const r of waiting) {
      const kind = overdueKind(r, now, this.policy);

      if (kind && r.assignee) {
        const released = await this.refills.expire(r.id, r.assignee, kind);
        if (released.status !== "OPEN") continue; // they acted at the last second; leave it
        const next = await this.assigner.assignNext(r.id);
        outcomes.push({ refillId: r.id, timedOut: r.assignee, reassignedTo: next.assignedTo });
      } else if (r.status === "OPEN") {
        // Nobody was available before; someone may be in the office now.
        const next = await this.assigner.assignNext(r.id);
        if (next.assignedTo) outcomes.push({ refillId: r.id, reassignedTo: next.assignedTo });
      }
    }
    return outcomes;
  }
}
