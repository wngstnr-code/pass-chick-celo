import { randomBytes } from "node:crypto";
import { createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

const EIP712_DOMAIN = {
  name: "ChickenCrossingSettlement",
  version: "1",
  chainId: env.CELO_CHAIN_ID,
  verifyingContract: env.GAME_SETTLEMENT_ADDRESS as Address,
} as const;

const PASSPORT_EIP712_DOMAIN = {
  name: "ChickenTrustPassport",
  version: "1",
  chainId: env.CELO_CHAIN_ID,
  verifyingContract: env.TRUST_PASSPORT_ADDRESS as Address,
} as const;

const RESOLUTION_TYPES = {
  Resolution: [
    { name: "sessionId", type: "bytes32" },
    { name: "player", type: "address" },
    { name: "stakeAmount", type: "uint256" },
    { name: "payoutAmount", type: "uint256" },
    { name: "finalMultiplierBp", type: "uint256" },
    { name: "outcome", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

const PASSPORT_CLAIM_TYPES = {
  PassportClaim: [
    { name: "player", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const SETTLEMENT_OUTCOME = {
  CASHED_OUT: 1,
  CRASHED: 2,
} as const;

export interface ResolutionPayload {
  sessionId: Hex;
  player: Address;
  stakeAmount: bigint;
  payoutAmount: bigint;
  finalMultiplierBp: bigint;
  outcome: number;
  deadline: bigint;
}

export interface SignedSettlementResult {
  signature: Hex;
  resolution: {
    sessionId: Hex;
    player: Address;
    stakeAmount: string;
    payoutAmount: string;
    finalMultiplierBp: string;
    outcome: number;
    deadline: string;
  };
  signerAddress: Address;
}

export interface PassportClaimPayload {
  player: Address;
  tier: number;
  issuedAt: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface SignedPassportClaimResult {
  signature: Hex;
  claim: {
    player: Address;
    tier: number;
    issuedAt: string;
    expiry: string;
    nonce: string;
  };
  signerAddress: Address;
}

let signerAccount: ReturnType<typeof privateKeyToAccount> | null = null;

function getSignerAccount() {
  if (!signerAccount) {
    try {
      signerAccount = privateKeyToAccount(env.BACKEND_PRIVATE_KEY as Hex);
      console.log(`🔑 Backend signer initialized: ${signerAccount.address}`);
    } catch (err) {
      console.error("❌ Failed to initialize signer. Check BACKEND_PRIVATE_KEY in .env");
      throw err;
    }
  }

  return signerAccount;
}

export function getSignerAddress(): Address {
  return getSignerAccount().address;
}

export function generateOnchainSessionId(): Hex {
  return `0x${randomBytes(32).toString("hex")}` as Hex;
}

export function usdcToUint256(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function createResolutionPayload(params: {
  playerAddress: string;
  onchainSessionId: string;
  stakeAmount: number;
  payoutAmount: number;
  finalMultiplierBp: number;
  outcome: number;
  deadline?: number;
}): ResolutionPayload {
  const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + env.SETTLEMENT_SIGNATURE_TTL_SECONDS;

  return {
    sessionId: params.onchainSessionId as Hex,
    player: params.playerAddress as Address,
    stakeAmount: usdcToUint256(params.stakeAmount),
    payoutAmount: usdcToUint256(params.payoutAmount),
    finalMultiplierBp: BigInt(params.finalMultiplierBp),
    outcome: params.outcome,
    deadline: BigInt(deadline),
  };
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
  const account = getSignerAccount();
  const resolution = createResolutionPayload(params);

  const walletClient = createWalletClient({
    account,
    transport: http(env.CELO_RPC_URL),
  });

  const signature = await walletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: RESOLUTION_TYPES,
    primaryType: "Resolution",
    message: resolution,
  });

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
    signerAddress: account.address,
  };
}

export function createPassportClaimPayload(params: {
  playerAddress: string;
  tier: number;
  issuedAt?: number;
  expiry?: number;
  nonce?: bigint;
}): PassportClaimPayload {
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = params.issuedAt ?? now;
  const expiry = params.expiry ?? now + env.PASSPORT_VALIDITY_SECONDS;
  const nonce =
    params.nonce ??
    BigInt(`0x${randomBytes(32).toString("hex")}`);

  return {
    player: params.playerAddress as Address,
    tier: params.tier,
    issuedAt: BigInt(issuedAt),
    expiry: BigInt(expiry),
    nonce,
  };
}

export async function signPassportClaim(params: {
  playerAddress: string;
  tier: number;
  issuedAt?: number;
  expiry?: number;
  nonce?: bigint;
}): Promise<SignedPassportClaimResult> {
  const account = getSignerAccount();
  const claim = createPassportClaimPayload(params);

  const walletClient = createWalletClient({
    account,
    transport: http(env.CELO_RPC_URL),
  });

  const signature = await walletClient.signTypedData({
    domain: PASSPORT_EIP712_DOMAIN,
    types: PASSPORT_CLAIM_TYPES,
    primaryType: "PassportClaim",
    message: claim,
  });

  return {
    signature,
    claim: {
      player: claim.player,
      tier: claim.tier,
      issuedAt: claim.issuedAt.toString(),
      expiry: claim.expiry.toString(),
      nonce: claim.nonce.toString(),
    },
    signerAddress: account.address,
  };
}
