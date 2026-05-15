import { Router } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();

const CHECKPOINT_ROW_INTERVAL = 40;

const TIER_RULES = [
  { tier: 1, label: "Runner", checkpoint: 2, requiredCashouts: 3 },
  { tier: 2, label: "Steady", checkpoint: 4, requiredCashouts: 4 },
  { tier: 3, label: "Elite", checkpoint: 6, requiredCashouts: 4 },
  { tier: 4, label: "Oracle", checkpoint: 8, requiredCashouts: 3 },
] as const;

const TIER_REWARDS = new Map<number, string>([
  [0, "Basic Profile"],
  [1, "Verified Identity"],
  [2, "Allowlist Eligible"],
  [3, "Tournament Access"],
  [4, "Partner Perks Passport"],
]);

const TIER_LABELS = new Map<number, string>([
  [0, "Rookie"],
  ...TIER_RULES.map((rule) => [rule.tier, rule.label] as const),
]);

type LeaderboardRow = {
  wallet_address?: string | null;
  [key: string]: unknown;
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countCashoutsAtOrAbove(
  checkpointCashouts: Record<string, number>,
  checkpoint: number,
) {
  return Object.entries(checkpointCashouts).reduce((sum, [cp, count]) => {
    return Number(cp) >= checkpoint ? sum + count : sum;
  }, 0);
}

function computeTier(checkpointCashouts: Record<string, number>) {
  let tier = 0;

  for (const rule of TIER_RULES) {
    const qualifiedCashouts = countCashoutsAtOrAbove(
      checkpointCashouts,
      rule.checkpoint,
    );

    if (qualifiedCashouts >= rule.requiredCashouts) {
      tier = rule.tier;
    }
  }

  return tier;
}

function buildAccessFlags(tier: number) {
  return {
    verifiedIdentity: tier >= 1,
    allowlistEligible: tier >= 2,
    tournamentAccess: tier >= 3,
    partnerPerks: tier >= 4,
  };
}

function buildTierMeta(tier: number) {
  return {
    passportTier: tier,
    passportTierLabel: TIER_LABELS.get(tier) ?? `Tier ${tier}`,
    passportReward: TIER_REWARDS.get(tier) ?? "Basic Profile",
    passportAccessFlags: buildAccessFlags(tier),
  };
}

async function addPassportTierMetadata<T extends LeaderboardRow>(
  rows: T[],
): Promise<Array<T & ReturnType<typeof buildTierMeta>>> {
  const wallets = Array.from(
    new Set(
      rows
        .map((row) => String(row.wallet_address || "").trim())
        .filter(Boolean),
    ),
  );

  if (wallets.length === 0) {
    return rows.map((row) => ({ ...row, ...buildTierMeta(0) }));
  }

  const { data, error } = await supabase
    .from("game_sessions")
    .select("wallet_address, max_row_reached, status")
    .in("wallet_address", wallets)
    .eq("status", "CASHED_OUT")
    .limit(2000);

  if (error) {
    console.error("Passport tier metadata query failed:", error);
    return rows.map((row) => ({ ...row, ...buildTierMeta(0) }));
  }

  const checkpointCashoutsByWallet = new Map<string, Record<string, number>>();

  for (const row of data ?? []) {
    const walletAddress = String(row.wallet_address || "").trim();
    if (!walletAddress) continue;

    const hops = toFiniteNumber(row.max_row_reached);
    const checkpoint = Math.floor(hops / CHECKPOINT_ROW_INTERVAL);
    if (checkpoint <= 0) continue;

    const counts = checkpointCashoutsByWallet.get(walletAddress) ?? {};
    counts[String(checkpoint)] = (counts[String(checkpoint)] ?? 0) + 1;
    checkpointCashoutsByWallet.set(walletAddress, counts);
  }

  return rows.map((row) => {
    const walletAddress = String(row.wallet_address || "").trim();
    const checkpointCashouts =
      checkpointCashoutsByWallet.get(walletAddress) ?? {};
    const tier = computeTier(checkpointCashouts);
    return { ...row, ...buildTierMeta(tier) };
  });
}

router.get("/", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard_distance")
      .select("*")
      .limit(100);

    if (error) {
      console.error("❌ Leaderboard query error:", error);

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("game_sessions")
        .select("wallet_address, max_row_reached, final_multiplier")
        .in("status", ["CASHED_OUT", "CRASHED"])
        .order("max_row_reached", { ascending: false })
        .limit(100);

      if (fallbackError) {
        res.status(500).json({ error: "Failed to load leaderboard." });
        return;
      }

      const walletMap = new Map<string, { best_score: number; games_played: number; best_multiplier: number }>();
      for (const row of fallbackData ?? []) {
        const existing = walletMap.get(row.wallet_address);
        if (!existing) {
          walletMap.set(row.wallet_address, {
            best_score: row.max_row_reached,
            games_played: 1,
            best_multiplier: row.final_multiplier,
          });
        } else {
          existing.games_played++;
          if (row.max_row_reached > existing.best_score) {
            existing.best_score = row.max_row_reached;
          }
          if (row.final_multiplier > existing.best_multiplier) {
            existing.best_multiplier = row.final_multiplier;
          }
        }
      }

      const leaderboard = Array.from(walletMap.entries())
        .map(([wallet_address, stats]) => ({ wallet_address, ...stats }))
        .sort((a, b) => b.best_score - a.best_score)
        .slice(0, 100);

      const leaderboardWithPassport = await addPassportTierMetadata(leaderboard);
      res.json({ leaderboard: leaderboardWithPassport, source: "fallback" });
      return;
    }

    const leaderboard = await addPassportTierMetadata(data ?? []);
    res.json({ leaderboard });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/profit", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard_profit")
      .select("*")
      .limit(100);

    if (error) {
      const { data: fallbackData } = await supabase
        .from("players")
        .select("wallet_address, total_games, total_wins, total_losses, total_profit")
        .gt("total_games", 0)
        .order("total_profit", { ascending: false })
        .limit(100);

      const leaderboard = await addPassportTierMetadata(fallbackData ?? []);
      res.json({ leaderboard, source: "fallback" });
      return;
    }

    const leaderboard = await addPassportTierMetadata(data ?? []);
    res.json({ leaderboard });
  } catch (err) {
    console.error("❌ Profit leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
