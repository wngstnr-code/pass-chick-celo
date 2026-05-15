import { type Hex } from "viem";
import {
  GAME_SETTLEMENT_ABI,
  GAME_SETTLEMENT_ADDRESS,
  backendAccount,
  normalizePlayerAddress,
  normalizeSessionId,
  publicClient,
  walletClient,
} from "../lib/celo.js";

type SettlementResolutionInput = {
  sessionId: string;
  player: string;
  stakeAmount: string | number | bigint;
  payoutAmount: string | number | bigint;
  finalMultiplierBp: string | number | bigint;
  outcome: string | number;
  deadline: string | number | bigint;
};

export function getSettlementRelayerAddress(): string {
  return backendAccount.address;
}

function toBigIntValue(value: string | number | bigint) {
  if (typeof value === "bigint") return value;
  return BigInt(String(value || "0"));
}

function readRpcErrorMessage(error: unknown) {
  return String(
    (error as { shortMessage?: string; message?: string })?.shortMessage ||
      (error as { message?: string })?.message ||
      (error as { toString?: () => string })?.toString?.() ||
      "",
  ).toLowerCase();
}

function isTransientRpcError(error: unknown) {
  const message = readRpcErrorMessage(error);
  return (
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket") ||
    message.includes("nonce too low") ||
    message.includes("replacement transaction underpriced")
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientRpcError(error) || attempt >= retries) throw error;
      const jitter = Math.floor(Math.random() * 140);
      await sleep(baseDelayMs * Math.pow(2, attempt) + jitter);
      attempt += 1;
    }
  }
}

function normalizeResolution(resolution: SettlementResolutionInput) {
  const outcomeNum = Number(resolution.outcome);
  if (outcomeNum !== 1 && outcomeNum !== 2) {
    throw new Error(`Invalid resolution.outcome: ${resolution.outcome}`);
  }
  return {
    sessionId: normalizeSessionId(resolution.sessionId),
    player: normalizePlayerAddress(String(resolution.player).trim()),
    stakeAmount: toBigIntValue(resolution.stakeAmount),
    payoutAmount: toBigIntValue(resolution.payoutAmount),
    finalMultiplierBp: toBigIntValue(resolution.finalMultiplierBp),
    outcome: outcomeNum,
    deadline: toBigIntValue(resolution.deadline),
  };
}

export async function submitSettlementOnchain(params: {
  resolution: SettlementResolutionInput;
  signature?: string;
}): Promise<string> {
  const normalized = normalizeResolution(params.resolution);
  if (!params.signature) {
    throw new Error("Settlement signature is required for Celo settleWithSignature.");
  }

  const hash = await withRpcRetry(
    () =>
      walletClient.writeContract({
        address: GAME_SETTLEMENT_ADDRESS,
        abi: GAME_SETTLEMENT_ABI,
        functionName: "settleWithSignature",
        args: [normalized, params.signature as Hex],
      }),
    { retries: 3, baseDelayMs: 400 },
  );

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
