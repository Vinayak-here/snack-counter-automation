import type { Money } from "../domain/money.js";

/** Everything the HR system needs for a reimbursement claim. */
export interface HrClaimRequest {
  /** Same key twice = same claim. We use the refill id, so a retry can't create a duplicate. */
  idempotencyKey: string;
  employeeId: string;
  amount: Money;          // in the office's currency; HR pays out in payroll currency
  description: string;
  receiptUrl: string;
}

export type HrClaimStatus =
  | { state: "PENDING" }
  | { state: "APPROVED" }
  | { state: "REJECTED"; reason: string };

/** The external HR system. Approval takes 1-10 days, so we submit, then check back later. */
export interface HrPort {
  submitClaim(claim: HrClaimRequest): Promise<{ claimId: string }>;
  getClaimStatus(claimId: string): Promise<HrClaimStatus>;
}
