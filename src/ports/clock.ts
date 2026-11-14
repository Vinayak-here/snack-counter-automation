/**
 * "What time is it?" is a dependency like any other. Services ask a Clock
 * instead of calling `new Date()`, so tests can use a fake clock and jump
 * forward in time (needed for timeouts in Phase 4).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
