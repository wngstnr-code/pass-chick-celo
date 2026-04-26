import { Router } from "express";
import { supabase } from "../config/supabase.js";

const router = Router();

/**
 * GET /api/leaderboard
 * Public endpoint — no auth required.
 * Returns top 100 players by distance (from Supabase view).
 */
router.get("/", async (_req, res) => {
  try {
    // Query the leaderboard_distance view
    const { data, error } = await supabase
      .from("leaderboard_distance")
      .select("*")
      .limit(100);

    if (error) {
      console.error("❌ Leaderboard query error:", error);

      // Fallback: query game_sessions directly
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

      // Aggregate manually
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

      res.json({ leaderboard, source: "fallback" });
      return;
    }

    res.json({ leaderboard: data ?? [] });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * GET /api/leaderboard/profit
 * Public endpoint — top 100 by profit.
 */
router.get("/profit", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard_profit")
      .select("*")
      .limit(100);

    if (error) {
      // Fallback query
      const { data: fallbackData } = await supabase
        .from("players")
        .select("wallet_address, total_games, total_wins, total_losses, total_profit")
        .gt("total_games", 0)
        .order("total_profit", { ascending: false })
        .limit(100);

      res.json({ leaderboard: fallbackData ?? [], source: "fallback" });
      return;
    }

    res.json({ leaderboard: data ?? [] });
  } catch (err) {
    console.error("❌ Profit leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
