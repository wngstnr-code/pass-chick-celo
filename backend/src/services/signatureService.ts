import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { backendAccount, normalizePlayerAddress, signSettlementResolution } from "../lib/celo.js";



export const SETTLEMENT_OUTCOME = {
  CASHED_OUT: 1,
  CRASHED: 2,
} as const;

export interface SignedSettlementResult {
  signature: string;
  resolution: {
    sessionId: string;
    player: string;
    stakeAmount: string;
    payoutAmount: string;
    finalMultiplierBp: string;
    outcome: number;
    deadline: string;
  };
  signerAddress: string;
}

export function generateOnchainSessionId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export function usdcToUint256(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export async function signSettlement(params: {
  playerAddress: string;
  onchainSessionId: string;
  stakeAmount: number;
  payoutAmount: number;
  finalMultiplierBp: number;
  outcome: number;
  deadline?: number;
}): Promise<SignedSettlementResult> {
  const deadline =
    params.deadline ?? Math.floor(Date.now() / 1000) + env.SETTLEMENT_SIGNATURE_TTL_SECONDS;

  const resolution = {
    sessionId: params.onchainSessionId,
    player: normalizePlayerAddress(params.playerAddress),
    stakeAmount: usdcToUint256(params.stakeAmount),
    payoutAmount: usdcToUint256(params.payoutAmount),
    finalMultiplierBp: BigInt(params.finalMultiplierBp),
    outcome: params.outcome,
    deadline: BigInt(deadline),
  };
  const signature = await signSettlementResolution(resolution);

  return {
    signature,
    resolution: {
      sessionId: resolution.sessionId,
      player: resolution.player,
      stakeAmount: resolution.stakeAmount.toString(),
      payoutAmount: resolution.payoutAmount.toString(),
      finalMultiplierBp: resolution.finalMultiplierBp.toString(),
      outcome: resolution.outcome,
      deadline: resolution.deadline.toString(),
    },
    signerAddress: backendAccount.address,
  };
}
