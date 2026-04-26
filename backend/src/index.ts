import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { setupGameGateway } from "./gateway/gameGateway.js";
import { startBlockchainListener } from "./services/blockchainListener.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import playerRoutes from "./routes/player.js";
import passportRoutes from "./routes/passport.js";
import { getActiveGameCount } from "./services/gameState.js";
import { readBackendSignerHealth } from "./services/opsHealth.js";

/**
 * ════════════════════════════════════════════════════════════
 * Pass Chick — Backend Server
 * ════════════════════════════════════════════════════════════
 *
 * Express.js + Socket.io server for the Pass Chick game.
 *
 * Responsibilities:
 *   1. SIWE Authentication (wallet-based login)
 *   2. WebSocket Game Gateway (real-time game validation)
 *   3. Anti-cheat (speed hack detection, server-authoritative timer)
 *   4. Cryptographic payout signature (EIP-712)
 *   5. Blockchain event listener (deposit/withdraw tracking)
 *   6. REST API (leaderboard, game history, player stats)
 */

// ── Express App ──────────────────────────────────────────────

const app = express();
app.set("trust proxy", 1); // Trust first proxy (Railway)

// Security middleware
app.use(
  helmet({
    // Allow Socket.io connections
    contentSecurityPolicy: false,
  })
);

// CORS — allow frontend origin with credentials (cookies)
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cookie parser
app.use(cookieParser());

// ── Routes ───────────────────────────────────────────────────

// Health check
app.get("/health", async (_req, res) => {
  try {
    const backendSigner = await readBackendSignerHealth();

    res.json({
      status: backendSigner.healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      activeGames: getActiveGameCount(),
      backendSigner,
    });
  } catch (error) {
    console.error("❌ Failed to build health response:", error);
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      activeGames: getActiveGameCount(),
    });
  }
});

// Auth routes (SIWE)
app.use("/auth", authRoutes);

// Game REST routes
app.use("/api/game", gameRoutes);

// Leaderboard (public)
app.use("/api/leaderboard", leaderboardRoutes);

// Player stats
app.use("/api/player", playerRoutes);

// Trust passport
app.use("/api/passport", passportRoutes);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── HTTP Server + Socket.io ──────────────────────────────────

const httpServer = createServer(app);

// Setup WebSocket game gateway on the same HTTP server
const io = setupGameGateway(httpServer);

// ── Start ────────────────────────────────────────────────────

httpServer.listen(env.PORT, "0.0.0.0", () => {
  console.log("");
  console.log("════════════════════════════════════════════════════");
  console.log("  🐔 Pass Chick Backend");
  console.log("════════════════════════════════════════════════════");
  console.log(`  HTTP Server:    http://localhost:${env.PORT}`);
  console.log(`  WebSocket:      ws://localhost:${env.PORT}`);
  console.log(`  Health Check:   http://localhost:${env.PORT}/health`);
  console.log(`  Frontend CORS:  ${env.FRONTEND_URL}`);
  console.log("════════════════════════════════════════════════════");
  console.log("");

  // Start blockchain event listener (non-blocking)
  startBlockchainListener().catch((err: unknown) => {
    console.error("⚠️  Blockchain listener failed to start:", err);
    console.log("   Backend continues without blockchain events.");
  });

  void readBackendSignerHealth()
    .then((backendSigner) => {
      const celoDisplay = backendSigner.balanceCelo.toFixed(6);
      console.log(`⛽ Backend signer: ${backendSigner.relayerAddress} | ${celoDisplay} CELO`);
      if (!backendSigner.healthy) {
        console.log(
          `⚠️  Backend signer balance is below recommended minimum (${backendSigner.minRecommendedCelo} CELO).`
        );
      }
    })
    .catch((error: unknown) => {
      console.error("⚠️  Failed to read backend signer health:", error);
    });
});

// ── Graceful Shutdown ────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down gracefully...");
  io.close();
  httpServer.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 SIGTERM received. Shutting down...");
  io.close();
  httpServer.close(() => {
    process.exit(0);
  });
});
