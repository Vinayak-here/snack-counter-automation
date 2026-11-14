import { InvalidTransitionError } from "./error.js";
import type  { RefillStatus } from "./types";

const ALLOWED: Record<RefillStatus, readonly RefillStatus[]> = {
  OPEN: ["ASSIGNED", "ACCEPTED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "OPEN", "CANCELLED"],
  ACCEPTED: ["PURCHASED", "OPEN", "CANCELLED"],
  PURCHASED: ["CLAIM_SUBMITTED"],
  CLAIM_SUBMITTED: ["REIMBURSED", "CLAIM_REJECTED"],
  REIMBURSED: [],
  CLAIM_REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: RefillStatus, to: RefillStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: RefillStatus, to: RefillStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isFinal(status: RefillStatus): boolean {
  return ALLOWED[status].length === 0;
}

export function isAwaitingPurchase(status: RefillStatus): boolean {
  return status === "OPEN" || status === "ASSIGNED" || status === "ACCEPTED";
}