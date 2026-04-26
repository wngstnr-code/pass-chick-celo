import { Router, type Request, type Response } from "express";
import { createPublicClient, http, parseAbi, isAddress, type Address } from "viem";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { signPassportClaim } from "../services/signatureService.js";

const router = Router();

const passportPublicClient = createPublicClient({
  transport: http(env.CELO_RPC_URL),
});

const TRUST_PASSPORT_READ_ABI = parseAbi([
  "function getPassport(address player) view returns (uint8 tier, uint64 issuedAt, uint64 expiry, bool revoked)",
  "function isPassportValid(address player) view returns (bool)",
]);

type PassportEligibility = {
  eligible: boolean;
  tier: number;
  reason: string;
  stats: {
    runsEvaluated: number;
    bestHops: number;
    averageHops: number;
  };
};

const MIN_RUNS_FOR_PASSPORT = 3;
const MIN_HOPS_FOR_TIER_1 = 25;

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeTier(bestHops: number) {
  if (bestHops >= 100) return 3;
  if (bestHops >= 60) return 2;
  if (bestHops >= MIN_HOPS_FOR_TIER_1) return 1;
  return 0;
}

async function evaluateEligibility(walletAddress: string): Promise<PassportEligibility> {
  const { data, error } = await supabase
    .from("game_sessions")
    .select("max_row_reached, status")
    .eq("wallet_address", walletAddress)
    .in("status", ["CRASHED", "CASHED_OUT"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const runsEvaluated = rows.length;
  const hops = rows.map((row) => toFiniteNumber(row.max_row_reached));
  const bestHops = hops.length ? Math.max(...hops) : 0;
  const averageHops =
    hops.length > 0
      ? hops.reduce((acc, value) => acc + value, 0) / hops.length
      : 0;

  if (runsEvaluated < MIN_RUNS_FOR_PASSPORT) {
    return {
      eligible: false,
      tier: 0,
      reason: `Butuh minimal ${MIN_RUNS_FOR_PASSPORT} run selesai untuk verifikasi.`,
      stats: { runsEvaluated, bestHops, averageHops },
    };
  }

  const tier = computeTier(bestHops);
  if (tier === 0) {
    return {
      eligible: false,
      tier: 0,
      reason: `Best hops kamu ${bestHops}. Capai minimal ${MIN_HOPS_FOR_TIER_1} hops untuk Tier 1.`,
      stats: { runsEvaluated, bestHops, averageHops },
    };
  }

  return {
    eligible: true,
    tier,
    reason: `Eligible untuk Trust Passport Tier ${tier}.`,
    stats: { runsEvaluated, bestHops, averageHops },
  };
}

async function readPassportOnchain(walletAddress: string) {
  if (!isAddress(env.TRUST_PASSPORT_ADDRESS)) {
    return {
      configured: false,
      valid: false,
      tier: 0,
      issuedAt: 0,
      expiry: 0,
      revoked: false,
    };
  }

  try {
    const [passport, valid] = await Promise.all([
      passportPublicClient.readContract({
        address: env.TRUST_PASSPORT_ADDRESS as Address,
        abi: TRUST_PASSPORT_READ_ABI,
        functionName: "getPassport",
        args: [walletAddress as Address],
      }),
      passportPublicClient.readContract({
        address: env.TRUST_PASSPORT_ADDRESS as Address,
        abi: TRUST_PASSPORT_READ_ABI,
        functionName: "isPassportValid",
        args: [walletAddress as Address],
      }),
    ]);

    return {
      configured: true,
      valid: Boolean(valid),
      tier: Number(passport[0] ?? 0),
      issuedAt: Number(passport[1] ?? 0),
      expiry: Number(passport[2] ?? 0),
      revoked: Boolean(passport[3]),
    };
  } catch (error) {
    console.error("❌ Failed to read passport onchain:", error);
    return {
      configured: true,
      valid: false,
      tier: 0,
      issuedAt: 0,
      expiry: 0,
      revoked: false,
    };
  }
}

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.walletAddress!;
    const [eligibility, passport] = await Promise.all([
      evaluateEligibility(walletAddress),
      readPassportOnchain(walletAddress),
    ]);

    res.json({
      walletAddress,
      eligibility,
      passport,
    });
  } catch (error) {
    console.error("❌ Passport status error:", error);
    res.status(500).json({ error: "Failed to load passport status." });
  }
});

router.post("/issue-signature", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.walletAddress!;

    if (!isAddress(env.TRUST_PASSPORT_ADDRESS)) {
      res.status(400).json({
        error: "TRUST_PASSPORT_ADDRESS belum valid di backend env.",
      });
      return;
    }

    const eligibility = await evaluateEligibility(walletAddress);
    if (!eligibility.eligible || eligibility.tier <= 0) {
      res.status(400).json({
        error: eligibility.reason,
        eligibility,
      });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const signatureExpiry = now + env.PASSPORT_SIGNATURE_TTL_SECONDS;
    const passportExpiry = now + env.PASSPORT_VALIDITY_SECONDS;

    const signed = await signPassportClaim({
      playerAddress: walletAddress,
      tier: eligibility.tier,
      issuedAt: now,
      expiry: passportExpiry,
    });

    res.json({
      success: true,
      claim: signed.claim,
      signature: signed.signature,
      signerAddress: signed.signerAddress,
      signingDomain: {
        chainId: env.CELO_CHAIN_ID,
        verifyingContract: env.TRUST_PASSPORT_ADDRESS,
      },
      signatureExpiry,
      eligibility,
    });
  } catch (error) {
    console.error("❌ Passport signature issue error:", error);
    res.status(500).json({ error: "Failed to issue passport signature." });
  }
});

export default router;
