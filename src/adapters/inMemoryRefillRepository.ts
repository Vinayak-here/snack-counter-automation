import { DuplicateActiveRefillError, VersionConflictError } from "../domain/error.js";
import { isAwaitingPurchase } from "../domain/refillStateMachine.js";
import type { OfficeId, Refill } from "../domain/types.js";
import type { RefillRepository } from "../ports/refillRepository.js";

export class InMemoryRefillRepository implements RefillRepository {
  private readonly refills = new Map<string, Refill>();

  async get(id: string): Promise<Refill | undefined> {
    const r = this.refills.get(id);
    return r ? structuredClone(r) : undefined;
  }

  async findAwaitingPurchase(officeId: OfficeId): Promise<Refill | undefined> {
    for (const r of this.refills.values()) {
      if (r.officeId === officeId && isAwaitingPurchase(r.status)) return structuredClone(r);
    }
    return undefined;
  }

  async listByOffice(officeId: OfficeId): Promise<Refill[]> {
    return [...this.refills.values()]
      .filter((r) => r.officeId === officeId)
      .sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime())
      .map((r) => structuredClone(r));
  }

  async listAll(): Promise<Refill[]> {
    return [...this.refills.values()].map((r) => structuredClone(r));
  }

  async create(refill: Omit<Refill, "version">): Promise<Refill> {
    for (const r of this.refills.values()) {
      if (r.officeId === refill.officeId && isAwaitingPurchase(r.status)) {
        throw new DuplicateActiveRefillError(refill.officeId);
      }
    }
    const stored: Refill = { ...structuredClone(refill), version: 1 };
    this.refills.set(stored.id, stored);
    return structuredClone(stored);
  }

  async save(refill: Refill, expectedVersion: number): Promise<Refill> {
    const current = this.refills.get(refill.id);
    const actual = current?.version ?? 0;
    if (actual !== expectedVersion) {
      throw new VersionConflictError(refill.id, expectedVersion, actual);
    }
    const stored: Refill = { ...structuredClone(refill), version: expectedVersion + 1 };
    this.refills.set(stored.id, stored);
    return structuredClone(stored);
  }
}