import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isHex,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

const GAME_SETTLEMENT_WRITE_ABI = parseAbi([
  "function settleWithSignature((bytes32 sessionId,address player,uint256 stakeAmount,uint256 payoutAmount,uint256 finalMultiplierBp,uint8 outcome,uint64 deadline) resolution, bytes signature)",
]);
const SETTLEMENT_GAS_BUFFER = 35_000n;
const SETTLEMENT_MIN_GAS_LIMIT = 420_000n;

type SettlementResolutionInput = {
  sessionId: string;
  player: string;
  stakeAmount: string | number | bigint;
  payoutAmount: string | number | bigint;
  finalMultiplierBp: string | number | bigint;
  outcome: string | number;
  deadline: string | number | bigint;
};

const account = privateKeyToAccount(env.BACKEND_PRIVATE_KEY as Hex);
const settlementWalletClient = createWalletClient({
  account,
  transport: http(env.CELO_RPC_URL),
});
const settlementPublicClient = createPublicClient({
  transport: http(env.CELO_RPC_URL),
});

export function getSettlementRelayerAddress(): Address {
  return account.address;
}

function toHexString(value: string) {
  return String(value || "").trim().toLowerCase();
}

function toBigIntValue(value: string | number | bigint) {
  if (typeof value === "bigint") return value;
  return BigInt(String(value || "0"));
}

function readRpcErrorMessage(error: unknown) {
  return String(
    (error as { shortMessage?: string; message?: string })?.shortMessage ||
      (error as { message?: string })?.message ||
      "",
  ).toLowerCase();
}

function isTransientRpcError(error: unknown) {
  const message = readRpcErrorMessage(error);
  return (
    message.includes("requests limited to 15/sec") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket")
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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
      if (!isTransientRpcError(error) || attempt >= retries) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 140);
      const backoffMs = baseDelayMs * Math.pow(2, attempt) + jitter;
      attempt += 1;
      await sleep(backoffMs);
    }
  }
}

function normalizeResolution(
  resolution: SettlementResolutionInput,
): {
  sessionId: Hex;
  player: Address;
  stakeAmount: bigint;
  payoutAmount: bigint;
  finalMultiplierBp: bigint;
  outcome: number;
  deadline: bigint;
} {
  const sessionId = toHexString(resolution.sessionId);
  const player = toHexString(resolution.player);

  if (!isHex(sessionId, { strict: true }) || sessionId.length !== 66) {
    throw new Error("Invalid resolution.sessionId");
  }

  if (!isHex(player, { strict: true }) || player.length !== 42) {
    throw new Error("Invalid resolution.player");
  }

  return {
    sessionId: sessionId as Hex,
    player: player as Address,
    stakeAmount: toBigIntValue(resolution.stakeAmount),
    payoutAmount: toBigIntValue(resolution.payoutAmount),
    finalMultiplierBp: toBigIntValue(resolution.finalMultiplierBp),
    outcome: Number(resolution.outcome),
    deadline: toBigIntValue(resolution.deadline),
  };
}

export async function submitSettlementOnchain(params: {
  resolution: SettlementResolutionInput;
  signature: string;
}): Promise<string> {
  const signature = toHexString(params.signature);
  if (!isHex(signature, { strict: true })) {
    throw new Error("Invalid settlement signature");
  }

  const normalizedResolution = normalizeResolution(params.resolution);
  const args = [normalizedResolution, signature as Hex] as const;

  await withRpcRetry(() =>
    settlementPublicClient.call({
      account: account.address,
      to: env.GAME_SETTLEMENT_ADDRESS as Address,
      data: encodeFunctionData({
        abi: GAME_SETTLEMENT_WRITE_ABI,
        functionName: "settleWithSignature",
        args,
      }),
    }),
  );

  const estimatedGas = await withRpcRetry(() =>
    settlementPublicClient.estimateContractGas({
      account,
      address: env.GAME_SETTLEMENT_ADDRESS as Address,
      abi: GAME_SETTLEMENT_WRITE_ABI,
      functionName: "settleWithSignature",
      args,
    }),
  );
  const gasLimit =
    estimatedGas + SETTLEMENT_GAS_BUFFER > SETTLEMENT_MIN_GAS_LIMIT
      ? estimatedGas + SETTLEMENT_GAS_BUFFER
      : SETTLEMENT_MIN_GAS_LIMIT;

  const txHash = await settlementWalletClient.writeContract({
    chain: null,
    address: env.GAME_SETTLEMENT_ADDRESS as Address,
    abi: GAME_SETTLEMENT_WRITE_ABI,
    functionName: "settleWithSignature",
    args,
    gas: gasLimit,
  });

  const receipt = await withRpcRetry(
    () =>
      settlementPublicClient.waitForTransactionReceipt({
        hash: txHash,
      }),
    { retries: 4, baseDelayMs: 500 },
  );

  if (receipt.status !== "success") {
    throw new Error("Settlement tx reverted");
  }

  return txHash;
}
