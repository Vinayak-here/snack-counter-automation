import type {RefillStatus} from "./types.js";

export class InvalidTransitionError extends Error {
    constructor(public readonly from: RefillStatus, public readonly to: RefillStatus) {
        super(`Invalid transition from ${from} to ${to}`);
        this.name = "InvalidTransitionError";
    }
}

/** Someone else saved this refill after you read it. */
export class VersionConflictError extends Error {
  constructor(refillId: string, expected: number, actual: number) {
    super(`Refill ${refillId} changed: expected version ${expected}, found ${actual}`);
    this.name = "VersionConflictError";
  }
}

/** The office already has a refill waiting for someone to buy. */
export class DuplicateActiveRefillError extends Error {
  constructor(officeId: string) {
    super(`Office ${officeId} already has a refill in progress`);
    this.name = "DuplicateActiveRefillError";
  }
}

/** Someone else already committed to buying for this refill. */
export class RefillAlreadyTakenError extends Error {
  constructor(refillId: string, takenBy: string) {
    super(`Refill ${refillId} was already accepted by ${takenBy}`);
    this.name = "RefillAlreadyTakenError";
  }
}

/** The action needs the current assignee, and this person isn't it. */
export class NotAssigneeError extends Error {
  constructor(refillId: string, employeeId: string) {
    super(`${employeeId} is not the assignee of refill ${refillId}`);
    this.name = "NotAssigneeError";
  }
}

export class RefillNotFoundError extends Error {
  constructor(refillId: string) {
    super(`Refill ${refillId} not found`);
    this.name = "RefillNotFoundError";
  }
}

/** This person already declined or timed out on this refill. */
export class AlreadyAskedError extends Error {
  constructor(refillId: string, employeeId: string) {
    super(`${employeeId} already declined or timed out on refill ${refillId}`);
    this.name = "AlreadyAskedError";
  }
}

/** Input that can never be valid, e.g. a purchase of 0 NOK or with no receipt. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
