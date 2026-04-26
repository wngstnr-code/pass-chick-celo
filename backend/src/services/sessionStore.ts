import crypto from "node:crypto";

/**
 * In-memory session store.
 * Maps session token → wallet address.
 *
 * For hackathon MVP this is sufficient.
 * Production: replace with Redis or database-backed sessions.
 */

interface SessionData {
  walletAddress: string;
  createdAt: number;
}

const sessions = new Map<string, SessionData>();

// Nonce store for SIWE (short-lived, ~5 min TTL)
const nonces = new Map<string, number>(); // nonce → timestamp

/** Generate a random session token */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Generate a random nonce for SIWE */
export function generateNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now());
  return nonce;
}

/** Validate that a nonce exists and hasn't expired (5 min TTL) */
export function consumeNonce(nonce: string): boolean {
  const timestamp = nonces.get(nonce);
  if (!timestamp) return false;

  nonces.delete(nonce);

  const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  if (Date.now() - timestamp > NONCE_TTL_MS) return false;

  return true;
}

/** Create a new session */
export function createSession(token: string, walletAddress: string): void {
  sessions.set(token, {
    walletAddress: walletAddress.toLowerCase(),
    createdAt: Date.now(),
  });
}

/** Get wallet address from session token */
export function getSession(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;

  // Session TTL: 24 hours
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }

  return session.walletAddress;
}

/** Delete a session */
export function deleteSession(token: string): void {
  sessions.delete(token);
}

/** Cleanup expired nonces and sessions (run periodically) */
export function cleanupExpired(): void {
  const now = Date.now();
  const NONCE_TTL = 5 * 60 * 1000;
  const SESSION_TTL = 24 * 60 * 60 * 1000;

  for (const [nonce, timestamp] of nonces.entries()) {
    if (now - timestamp > NONCE_TTL) nonces.delete(nonce);
  }

  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpired, 10 * 60 * 1000);
