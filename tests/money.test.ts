import { describe, it, expect } from "vitest";
import {
  money, add, subtract, sum, isGreaterThan, format, zero,
  CurrencyMismatchError, moneyMinor,
} from "../src/domain/money.js";

describe("Money", () => {
  it("stores amounts as integer minor units", () => {
    expect(money(1250.5, "NOK").amountMinor).toBe(125050);
  });

  it("adds exactly where floating point would fail", () => {
    // 0.1 + 0.2 in plain JS is 0.30000000000000004
    const total = add(money(0.1, "NOK"), money(0.2, "NOK"));
    expect(total.amountMinor).toBe(30);
    expect(format(total)).toBe("0.30 NOK");
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(100, "NOK"), money(100, "INR"))).toThrow(CurrencyMismatchError);
  });

  it("sums a list in one currency", () => {
    const total = sum([money(300, "INR"), money(1200.75, "INR")], "INR");
    expect(format(total)).toBe("1500.75 INR");
  });

  it("sum of empty list is zero", () => {
    expect(sum([], "NOK")).toEqual(zero("NOK"));
  });

  it("subtracts and compares", () => {
    const left = subtract(money(6000, "NOK"), money(1200, "NOK"));
    expect(format(left)).toBe("4800.00 NOK");
    expect(isGreaterThan(money(1300, "NOK"), left)).toBe(false);
  });

  it("rejects non-integer minor units", () => {
    expect(() => moneyMinor(10.5, "INR")).toThrow();
  });
});
