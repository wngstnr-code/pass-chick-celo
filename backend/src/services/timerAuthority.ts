import { SEGMENT_TIME_MS, DECAY_BP_PER_SEC, CP_MAX_STAY_MS } from "../config/constants.js";

export interface TimerState {
  segmentActive: boolean;
  segmentStart: number;
  cashoutWindow: boolean;
  cpEnterTime: number;
}
export function createTimerState(): TimerState {
  return {
    segmentActive: true,
    segmentStart: Date.now(),
    cashoutWindow: false,
    cpEnterTime: 0,
  };
}

export function getSegmentRemainingMs(state: TimerState, now: number = Date.now()): number {
  if (!state.segmentActive) return SEGMENT_TIME_MS;
  const elapsed = now - state.segmentStart;
  return Math.max(0, SEGMENT_TIME_MS - elapsed);
}
export function getCurrentDecayBp(state: TimerState, now: number = Date.now()): number {
  if (!state.segmentActive) return 0;
  const elapsed = now - state.segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;
  if (overtime <= 0) return 0;
  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}
export function onReachCheckpoint(state: TimerState): TimerState {
  return {
    ...state,
    segmentActive: false,
    cashoutWindow: true,
    cpEnterTime: Date.now(),
  };
}

export function onLeaveCheckpoint(state: TimerState): TimerState {
  return {
    ...state,
    segmentActive: true,
    segmentStart: Date.now(),
    cashoutWindow: false,
    cpEnterTime: 0,
  };
}

export function isCpStayExpired(state: TimerState, now: number = Date.now()): boolean {
  if (!state.cashoutWindow) return false;
  return (now - state.cpEnterTime) > CP_MAX_STAY_MS;
}

export function getCpStayRemainingMs(state: TimerState, now: number = Date.now()): number {
  if (!state.cashoutWindow) return 0;
  return Math.max(0, CP_MAX_STAY_MS - (now - state.cpEnterTime));
}
