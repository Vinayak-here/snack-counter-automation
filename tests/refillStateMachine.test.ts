import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../src/domain/error.js";
import {
  assertTransition,
  canTransition,
  isAwaitingPurchase,
  isFinal,
} from "../src/domain/refillStateMachine.js";

describe("refill state machine", () => {
  it("allows every step of the normal path", () => {
    expect(canTransition("OPEN", "ASSIGNED")).toBe(true);
    expect(canTransition("ASSIGNED", "ACCEPTED")).toBe(true);
    expect(canTransition("ACCEPTED", "PURCHASED")).toBe(true);
    expect(canTransition("PURCHASED", "CLAIM_SUBMITTED")).toBe(true);
    expect(canTransition("CLAIM_SUBMITTED", "REIMBURSED")).toBe(true);
  });

  it("forbids skipping steps", () => {
    expect(canTransition("OPEN", "PURCHASED")).toBe(false);
    expect(canTransition("OPEN", "REIMBURSED")).toBe(false);
    expect(canTransition("ASSIGNED", "PURCHASED")).toBe(false);
  });

  it("lets a refill go back to OPEN when the person declines or times out", () => {
    expect(canTransition("ASSIGNED", "OPEN")).toBe(true);
    expect(canTransition("ACCEPTED", "OPEN")).toBe(true);
  });

  it("can't be cancelled once snacks are bought", () => {
    expect(canTransition("OPEN", "CANCELLED")).toBe(true);
    expect(canTransition("PURCHASED", "CANCELLED")).toBe(false);
  });

  it("final states have no way out", () => {
    expect(isFinal("REIMBURSED")).toBe(true);
    expect(isFinal("CLAIM_REJECTED")).toBe(true);
    expect(isFinal("CANCELLED")).toBe(true);
    expect(isFinal("ACCEPTED")).toBe(false);
  });

  it("assertTransition throws a named error for an illegal move", () => {
    expect(() => assertTransition("OPEN", "REIMBURSED")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("OPEN", "ASSIGNED")).not.toThrow();
  });

  it("the box counts as empty only until someone buys", () => {
    expect(isAwaitingPurchase("OPEN")).toBe(true);
    expect(isAwaitingPurchase("ASSIGNED")).toBe(true);
    expect(isAwaitingPurchase("ACCEPTED")).toBe(true);
    expect(isAwaitingPurchase("PURCHASED")).toBe(false);
    expect(isAwaitingPurchase("CLAIM_SUBMITTED")).toBe(false);
  });
});
