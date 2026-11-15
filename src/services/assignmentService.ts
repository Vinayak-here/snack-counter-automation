import { pickNextBuyer } from "../domain/rotation.js";
import type { OfficeId, Refill } from "../domain/types.js";
import type { Clock } from "../ports/clock.js";
import type { RefillRepository } from "../ports/refillRepository.js";
import type { VolunteerDirectory } from "../ports/volunteerDirectory.js";
import type { RefillService } from "./refillService.js";

export interface AssignResult {
  refill: Refill;
  /** null = nobody eligible right now; the refill stays OPEN. */
  assignedTo: string | null;
}

/** Decides WHO buys, then asks RefillService to do the assigning. */
export class AssignmentService {
  constructor(
    private readonly refills: RefillService,
    private readonly repo: RefillRepository,
    private readonly volunteers: VolunteerDirectory,
    private readonly clock: Clock,
  ) {}

  async assignNext(refillId: string): Promise<AssignResult> {
    const refill = await this.refills.get(refillId);
    const candidate = pickNextBuyer(
      await this.volunteers.listAll(),
      await this.repo.listAll(),
      refill.officeId,
      refill.declinedOrTimedOut,
      this.clock.now(),
    );
    if (!candidate) return { refill, assignedTo: null };

    const assigned = await this.refills.assign(refill.id, candidate.employeeId);
    return { refill: assigned, assignedTo: candidate.employeeId };
  }

  /** "Box is empty" from chat: create (or find) the refill and make sure someone is asked. */
  async reportEmptyAndAssign(officeId: OfficeId, reportedBy: string): Promise<AssignResult> {
    const { refill } = await this.refills.reportEmpty(officeId, reportedBy);
    // New refill, or an old one nobody could take earlier: try to find someone now.
    if (refill.status === "OPEN") return this.assignNext(refill.id);
    return { refill, assignedTo: refill.assignee ?? null }; // already being handled
  }
}
