import type { Currency, Money } from "./money.js";

export type OfficeId = "OSLO" | "BLR";

export interface Office {
  id: OfficeId;
  name: string;
  currency: Currency;      // the office's budget currency
  monthlyBudget: Money;
}

/** Where a person is on a given day. Only "IN_OFFICE" people can be asked to buy. */
export type PresenceStatus = "IN_OFFICE" | "REMOTE" | "HOLIDAY";

export interface Volunteer {
  employeeId: string;
  name: string;
  homeOffice: OfficeId;
  /** Normally equals homeOffice; changes when someone visits the other office. */
  currentOffice: OfficeId;
  presence: PresenceStatus;
  active: boolean;         // false = opted out of volunteering
}

/**
 * Every state a refill can be in. A refill only moves forward through
 * these states via the RefillService (Phase 2), never by editing it directly.
 */
export type RefillStatus =
  | "OPEN"             // box reported empty, nobody assigned yet
  | "ASSIGNED"         // system asked one person, waiting for "yes"
  | "ACCEPTED"         // that person said yes, they will buy
  | "PURCHASED"        // bought + receipt uploaded
  | "CLAIM_SUBMITTED"  // sent to HR system
  | "REIMBURSED"       // HR paid the volunteer (final)
  | "CLAIM_REJECTED"   // HR said no (final, needs a human)
  | "CANCELLED";       // e.g. reported by mistake (final)

export interface Refill {
  id: string;
  officeId: OfficeId;
  status: RefillStatus;
  reportedBy: string;
  reportedAt: Date;

  assignee?: string;          // employeeId currently responsible
  assignedAt?: Date;
  acceptedAt?: Date;
  /** People already asked for this refill, so we don't ask them again. */
  declinedOrTimedOut: string[];

  purchase?: {
    amount: Money;           // always in the office's currency
    items: string[];         // which snacks were bought
    receiptUrl: string;
    purchasedAt: Date;
  };

  hrClaimId?: string;
  reimbursedAt?: Date;
}
