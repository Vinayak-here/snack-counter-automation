import type { HrClaimRequest, HrClaimStatus, HrPort } from "../ports/hrPort.js";

/**
 * Pretend HR system. Tests decide when a claim is approved or rejected,
 * and can make the next submit fail to simulate HR being down.
 */
export class FakeHr implements HrPort {
  readonly claims = new Map<string, { request: HrClaimRequest; status: HrClaimStatus }>();
  private readonly byKey = new Map<string, string>();
  private failNext = false;
  private counter = 0;

  async submitClaim(claim: HrClaimRequest): Promise<{ claimId: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("HR system unavailable");
    }
    const existing = this.byKey.get(claim.idempotencyKey);
    if (existing) return { claimId: existing }; // same key: same claim, no duplicate
    const claimId = `hr-${++this.counter}`;
    this.byKey.set(claim.idempotencyKey, claimId);
    this.claims.set(claimId, { request: structuredClone(claim), status: { state: "PENDING" } });
    return { claimId };
  }

  async getClaimStatus(claimId: string): Promise<HrClaimStatus> {
    const c = this.claims.get(claimId);
    if (!c) throw new Error(`Unknown claim ${claimId}`);
    return c.status;
  }

  // ---- test controls ----
  approve(claimId: string): void {
    this.setStatus(claimId, { state: "APPROVED" });
  }

  reject(claimId: string, reason: string): void {
    this.setStatus(claimId, { state: "REJECTED", reason });
  }

  failNextSubmit(): void {
    this.failNext = true;
  }

  private setStatus(claimId: string, status: HrClaimStatus): void {
    const c = this.claims.get(claimId);
    if (!c) throw new Error(`Unknown claim ${claimId}`);
    c.status = status;
  }
}
