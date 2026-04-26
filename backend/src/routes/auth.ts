import { Router } from "express";
import { SiweMessage } from "siwe";
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

    // Upsert player in database
    const { error: dbError } = await supabase
      .from("players")
      .upsert(
        { wallet_address: walletAddress },
        { onConflict: "wallet_address" }
      );

    if (dbError) {
      console.error("❌ Supabase Error (player-upsert):", {
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint,
        code: dbError.code,
      });
      // Don't block auth for DB errors in hackathon, but we'll know it failed.
    }

    // Create session
    const token = generateSessionToken();
    createSession(token, walletAddress);

    // Set HttpOnly cookie
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: "/",
    });

    res.json({
      success: true,
      address: walletAddress,
    });
  } catch (err) {
    console.error("❌ Auth verify error:", err);
    res.status(500).json({ error: "Authentication failed." });
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
