import type { Clock } from "../ports/clock.js";

/** A clock that only moves when a test tells it to. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = "2026-11-02T09:00:00Z") {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current); // copy, so callers can't move our clock
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  set(to: Date | string): void {
    this.current = new Date(to);
  }
}
