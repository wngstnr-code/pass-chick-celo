import {
  CP_INTERVAL,
  SEGMENT_TIME_MS,
  DECAY_BP_PER_SEC,
  MIN_MOVE_INTERVAL_MS,
  MAX_MOVES_PER_WINDOW,
  MOVE_WINDOW_MS,
} from "../config/constants.js";
export function isMoveToFast(lastMoveTime: number, now: number): boolean {
  if (lastMoveTime === 0) return false;
  return (now - lastMoveTime) < MIN_MOVE_INTERVAL_MS;
}
export function isSpeedHack(
  moveTimestamps: number[],
  maxMoves: number = MAX_MOVES_PER_WINDOW,
  windowMs: number = MOVE_WINDOW_MS
): boolean {
  if (moveTimestamps.length < maxMoves) return false;
  const recentMoves = moveTimestamps.slice(-maxMoves);
  const timeSpan = recentMoves[recentMoves.length - 1] - recentMoves[0];

  return timeSpan < windowMs;
}
export function calculateDecayBp(segmentStart: number, now: number): number {
  const elapsed = now - segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;

  if (overtime <= 0) return 0;

  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}
export function getEffectiveMultiplierBp(
  baseMultiplierBp: number,
  segmentStart: number,
  now: number
): number {
  const decay = calculateDecayBp(segmentStart, now);
  return Math.max(0, baseMultiplierBp - decay);
}
export function isCheckpointRow(rowIndex: number): boolean {
  return rowIndex > 0 && rowIndex % CP_INTERVAL === 0;
}
