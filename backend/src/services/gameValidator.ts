import {
  STEP_INCREMENT_BP,
  CP_BONUS_NUM,
  CP_BONUS_DEN,
  CP_INTERVAL,
  SEGMENT_TIME_MS,
  DECAY_BP_PER_SEC,
  MIN_MOVE_INTERVAL_MS,
  MAX_MOVES_PER_WINDOW,
  MOVE_WINDOW_MS,
} from "../config/constants.js";

/**
 * Pure game validation functions.
 * No side effects — all calculations are deterministic.
 */

// ── Multiplier Calculation ───────────────────────────────────

/**
 * Calculate the multiplier for a given number of forward steps and CPs.
 * This is the "absolute truth" — if the frontend reports something different,
 * we trust the server's calculation.
 *
 * Algorithm:
 *   1. Start at 0.00x
 *   2. Each forward step: +0.025x (= +250 bp)
 *   3. At each checkpoint (every 40 steps): multiply by 1.2
 *
 * @param forwardSteps - Number of NEW forward rows reached
 * @param cpCount - Number of checkpoints passed
 * @returns multiplier in basis points (10000 = 1.00x)
 */
export function calculateMultiplierBp(forwardSteps: number, cpCount: number): number {
  let multiplierBp = 0;
  let cpsPassed = 0;

  for (let step = 1; step <= forwardSteps; step++) {
    multiplierBp += STEP_INCREMENT_BP;

    // Check if this step is a checkpoint
    if (step % CP_INTERVAL === 0) {
      cpsPassed++;
      multiplierBp = Math.floor((multiplierBp * CP_BONUS_NUM) / CP_BONUS_DEN);
    }
  }

  // Safety check — cpsPassed should match cpCount
  if (cpsPassed !== cpCount) {
    console.warn(
      `⚠️ CP mismatch: calculated ${cpsPassed} CPs but state says ${cpCount}`
    );
  }

  return multiplierBp;
}

// ── Anti-Speedhack ───────────────────────────────────────────

/**
 * Check if the interval between moves is reasonable.
 * A human cannot press keys faster than ~120ms consistently.
 *
 * @returns true if the move is suspicious (too fast)
 */
export function isMoveToFast(lastMoveTime: number, now: number): boolean {
  if (lastMoveTime === 0) return false; // First move
  return (now - lastMoveTime) < MIN_MOVE_INTERVAL_MS;
}

/**
 * Check if move frequency exceeds human limits.
 * If a player makes >40 moves in 5 seconds, it's likely a bot/macro.
 *
 * @returns true if cheating detected
 */
export function isSpeedHack(
  moveTimestamps: number[],
  maxMoves: number = MAX_MOVES_PER_WINDOW,
  windowMs: number = MOVE_WINDOW_MS
): boolean {
  if (moveTimestamps.length < maxMoves) return false;

  // Check the last N moves
  const recentMoves = moveTimestamps.slice(-maxMoves);
  const timeSpan = recentMoves[recentMoves.length - 1] - recentMoves[0];

  return timeSpan < windowMs;
}

// ── Decay Calculation ────────────────────────────────────────

/**
 * Calculate the decay penalty in basis points.
 * After segment time is up, multiplier decays at -0.1x per second.
 *
 * @param segmentStart - Timestamp when segment started
 * @param now - Current timestamp
 * @returns decay amount in basis points (always >= 0)
 */
export function calculateDecayBp(segmentStart: number, now: number): number {
  const elapsed = now - segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;

  if (overtime <= 0) return 0;

  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}

/**
 * Get effective multiplier after applying decay.
 *
 * @param baseMultiplierBp - Multiplier before decay
 * @param segmentStart - When current segment started
 * @param now - Current time
 * @returns effective multiplier in basis points (min 0)
 */
export function getEffectiveMultiplierBp(
  baseMultiplierBp: number,
  segmentStart: number,
  now: number
): number {
  const decay = calculateDecayBp(segmentStart, now);
  return Math.max(0, baseMultiplierBp - decay);
}

// ── Payout Calculation ───────────────────────────────────────

/**
 * Calculate payout amount.
 *
 * @param stake - Original stake (USDC)
 * @param multiplierBp - Final multiplier in basis points
 * @returns payout amount (USDC)
 */
export function calculatePayout(stake: number, multiplierBp: number): number {
  return (stake * multiplierBp) / 10000;
}

/**
 * Calculate profit (can be negative).
 */
export function calculateProfit(stake: number, payout: number): number {
  return payout - stake;
}

// ── Row Validation ───────────────────────────────────────────

/**
 * Check if a row index is a checkpoint.
 */
export function isCheckpointRow(rowIndex: number): boolean {
  return rowIndex > 0 && rowIndex % CP_INTERVAL === 0;
}
