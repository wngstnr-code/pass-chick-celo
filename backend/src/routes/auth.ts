import { type Response, Router } from "express";
import { SiweMessage } from "siwe";
import { isAddress } from "viem";
import {
  generateNonce,
  consumeNonce,
  generateSessionToken,
  createSession,
  deleteSession,
} from "../services/sessionStore.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";

const router = Router();

function persistSessionCookie(res: Response) {
  return (token: string) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });
  };
}

async function ensurePlayerRecord(walletAddress: string) {
  const { error: dbError } = await supabase
    .from("players")
    .upsert({ wallet_address: walletAddress }, { onConflict: "wallet_address" });

  if (dbError) {
    console.error("❌ Supabase Error (player-upsert):", {
      message: dbError.message,
      details: dbError.details,
      hint: dbError.hint,
      code: dbError.code,
    });
  }
}

function createAuthenticatedSession(
  res: Response,
  walletAddress: string,
) {
  const token = generateSessionToken();
  createSession(token, walletAddress);
  persistSessionCookie(res)(token);
}

/**
 * GET /auth/nonce
 * Generate a random nonce for SIWE message.
 */
router.get("/nonce", (_req, res) => {
  const nonce = generateNonce();
  res.json({ nonce });
});

/**
 * POST /auth/verify
 * Verify a SIWE signature and create an authenticated session.
 *
 * Body: { message: string, signature: string }
 */
router.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;

    if (!message || !signature) {
      res.status(400).json({ error: "Missing message or signature." });
      return;
    }

    // Parse and verify the SIWE message
    const siweMessage = new SiweMessage(message);
    const result = await siweMessage.verify({ signature });

    if (!result.success) {
      res.status(401).json({ error: "Invalid signature." });
      return;
    }

    // Validate nonce
    const nonceValid = consumeNonce(result.data.nonce);
    if (!nonceValid) {
      res.status(401).json({ error: "Invalid or expired nonce." });
      return;
    }

    const walletAddress = result.data.address.toLowerCase();

    await ensurePlayerRecord(walletAddress);
    createAuthenticatedSession(res, walletAddress);

    res.json({
      success: true,
      address: walletAddress,
      authMethod: "siwe",
    });
  } catch (err) {
    console.error("❌ Auth verify error:", err);
    res.status(500).json({ error: "Authentication failed." });
  }
});

/**
 * POST /auth/minipay
 * Create a session for an injected MiniPay wallet without message signing.
 *
 * Body: { address: string, chainId?: number, walletProvider?: string }
 */
router.post("/minipay", async (req, res) => {
  try {
    if (!env.MINIPAY_UNVERIFIED_AUTH_ENABLED) {
      res.status(403).json({
        error: "MiniPay auth is disabled on this backend.",
      });
      return;
    }

    const {
      address,
      chainId,
      walletProvider,
    }: {
      address?: string;
      chainId?: number;
      walletProvider?: string;
    } = req.body ?? {};

    if (!address || !isAddress(address)) {
      res.status(400).json({ error: "Missing or invalid wallet address." });
      return;
    }

    if (
      chainId !== undefined &&
      Number.isFinite(chainId) &&
      Number(chainId) !== env.CELO_CHAIN_ID
    ) {
      res.status(400).json({
        error: `MiniPay auth requires Celo chain ${env.CELO_CHAIN_ID}.`,
      });
      return;
    }

    if (walletProvider && walletProvider.toLowerCase() !== "minipay") {
      res.status(400).json({ error: "Unsupported MiniPay wallet provider." });
      return;
    }

    const walletAddress = address.toLowerCase();
    await ensurePlayerRecord(walletAddress);
    createAuthenticatedSession(res, walletAddress);

    res.json({
      success: true,
      address: walletAddress,
      authMethod: "minipay",
    });
  } catch (err) {
    console.error("❌ MiniPay auth error:", err);
    res.status(500).json({ error: "MiniPay authentication failed." });
  }
});

/**
 * POST /auth/logout
 * Clear the session cookie and delete server-side session.
 */
router.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    deleteSession(token);
  }

  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.json({ success: true });
});

/**
 * GET /auth/me
 * Check current session status.
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    address: req.walletAddress,
  });
});

export default router;
