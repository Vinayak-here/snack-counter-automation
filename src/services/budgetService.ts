import { budgetStatus, type BudgetStatus } from "../domain/budget.js";
import type { Office, OfficeId } from "../domain/types.js";
import type { Clock } from "../ports/clock.js";
import type { RefillRepository } from "../ports/refillRepository.js";

/** Read-only budget questions, e.g. for the chat message "you can spend up to 1,800 NOK". */
export class BudgetService {
  constructor(
    private readonly repo: RefillRepository,
    private readonly offices: Record<OfficeId, Office>,
    private readonly clock: Clock,
  ) {}

  /** This month's budget, spend and remaining for one office (or for the month containing `at`). */
  async status(officeId: OfficeId, at: Date = this.clock.now()): Promise<BudgetStatus> {
    return budgetStatus(this.offices[officeId], await this.repo.listByOffice(officeId), at);
  }
}
