import { SEGMENT_TIME_MS, DECAY_BP_PER_SEC, CP_MAX_STAY_MS } from "../config/constants.js";

/**
 * Server-authoritative timer logic.
 *
 * The server is the ONLY source of truth for:
 * 1. Segment timer (60s between CPs)
 * 2. CP stay timer (60s max at checkpoint)
 * 3. Decay penalty calculation
 *
 * Browser timers are cosmetic only.
 */

export interface TimerState {
  /** Whether the segment timer is actively running */
  segmentActive: boolean;

  /** Timestamp (ms) when current segment started */
  segmentStart: number;

  /** Whether player is in a cashout window at a CP */
  cashoutWindow: boolean;

  /** Timestamp when player entered the checkpoint */
  cpEnterTime: number;
}

/**
 * Create initial timer state when game starts.
 */
export function createTimerState(): TimerState {
  return {
    segmentActive: true,
    segmentStart: Date.now(),
    cashoutWindow: false,
    cpEnterTime: 0,
  };
}

/**
 * Get remaining segment time in milliseconds.
 * Returns 0 if overtime.
 */
export function getSegmentRemainingMs(state: TimerState, now: number = Date.now()): number {
  if (!state.segmentActive) return SEGMENT_TIME_MS; // Frozen
  const elapsed = now - state.segmentStart;
  return Math.max(0, SEGMENT_TIME_MS - elapsed);
}

/**
 * Check if the segment has gone overtime (decay zone).
 */
export function isOvertime(state: TimerState, now: number = Date.now()): boolean {
  if (!state.segmentActive) return false;
  return (now - state.segmentStart) > SEGMENT_TIME_MS;
}

/**
 * Calculate current decay penalty in basis points.
 */
export function getCurrentDecayBp(state: TimerState, now: number = Date.now()): number {
  if (!state.segmentActive) return 0;
  const elapsed = now - state.segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;
  if (overtime <= 0) return 0;
  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}

/**
 * Called when player reaches a checkpoint.
 * Freezes segment timer, opens cashout window.
 */
export function onReachCheckpoint(state: TimerState): TimerState {
  return {
    ...state,
    segmentActive: false,
    cashoutWindow: true,
    cpEnterTime: Date.now(),
  };
}

/**
 * Called when player leaves a checkpoint (moves forward).
 * Closes cashout window, starts new segment timer.
 */
export function onLeaveCheckpoint(state: TimerState): TimerState {
  return {
    ...state,
    segmentActive: true,
    segmentStart: Date.now(),
    cashoutWindow: false,
    cpEnterTime: 0,
  };
}

/**
 * Check if player has exceeded the max stay time at a checkpoint.
 */
export function isCpStayExpired(state: TimerState, now: number = Date.now()): boolean {
  if (!state.cashoutWindow) return false;
  return (now - state.cpEnterTime) > CP_MAX_STAY_MS;
}

/**
 * Get remaining time at checkpoint before forced exit.
 */
export function getCpStayRemainingMs(state: TimerState, now: number = Date.now()): number {
  if (!state.cashoutWindow) return 0;
  return Math.max(0, CP_MAX_STAY_MS - (now - state.cpEnterTime));
}
