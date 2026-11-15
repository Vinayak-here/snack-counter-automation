import type { OfficeId, Refill } from "../domain/types.js";

export interface RefillRepository {
  get(id: string): Promise<Refill | undefined>;
  findAwaitingPurchase(officeId: OfficeId): Promise<Refill | undefined>;
  listByOffice(officeId: OfficeId): Promise<Refill[]>;
  listAll(): Promise<Refill[]>;
  create(refill: Omit<Refill, "version">): Promise<Refill>;
  save(refill: Refill, expectedVersion: number): Promise<Refill>;
}