import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  FAUCET_ABI,
  FAUCET_CONTRACT_ADDRESS,
  GAME_SETTLEMENT_ABI,
  GAME_SETTLEMENT_ADDRESS,
  GAME_VAULT_ABI,
  GAME_VAULT_ADDRESS,
  publicClient,
} from "../lib/celo.js";

type TransactionType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "TREASURY_FUNDED"
  | "SESSION_STARTED"
  | "SESSION_SETTLED";

let isListening = false;
let unwatchers: Array<() => void> = [];

function unitsToToken(amount: bigint): number {
  return Number(amount) / 10 ** env.TOKEN_DECIMALS;
}

async function ensurePlayer(walletAddress: string) {
  const { error } = await supabase
    .from("players")
    .upsert({ wallet_address: walletAddress }, { onConflict: "wallet_address" });
  if (error) {
    console.error(`❌ Failed to ensure player ${walletAddress}:`, error);
  }
}

async function logTransaction(params: {
  txHash: string;
  walletAddress: string;
  type: TransactionType;
  amount: number;
  onchainSessionId?: string;
}) {
  const { error } = await supabase.from("transactions").upsert(
    {
      tx_hash: params.txHash,
      wallet_address: params.walletAddress,
      type: params.type,
      amount: params.amount,
      onchain_session_id: params.onchainSessionId ?? null,
    },
    { onConflict: "tx_hash" },
  );
  if (error) {
    console.error(`❌ Failed to log transaction ${params.txHash}:`, error);
  }
}

function txHash(log: { transactionHash?: string | null }) {
  return String(log.transactionHash || "");
}

export async function startBlockchainListener(): Promise<void> {
  if (isListening) return;

  try {
    console.log(`🔗 Starting Celo event listener on ${env.RPC_URL}`);
    console.log(`   Vault: ${GAME_VAULT_ADDRESS}`);
    console.log(`   Settlement: ${GAME_SETTLEMENT_ADDRESS}`);

    unwatchers = [
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "Deposited",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.account;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "DEPOSIT",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle Deposited event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "Withdrawn",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.account;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "WITHDRAW",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle Withdrawn event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "TreasuryFunded",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.funder;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "TREASURY_FUNDED",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle TreasuryFunded event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_SETTLEMENT_ADDRESS,
        abi: GAME_SETTLEMENT_ABI,
        eventName: "SessionStarted",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.player;
              const sessionId = log.args.sessionId;
              if (!walletAddress || !sessionId || log.args.stakeAmount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "SESSION_STARTED",
                amount: unitsToToken(log.args.stakeAmount),
                onchainSessionId: sessionId,
              });
            })().catch((err) => console.error("❌ Failed to handle SessionStarted event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_SETTLEMENT_ADDRESS,
        abi: GAME_SETTLEMENT_ABI,
        eventName: "SessionSettled",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.player;
              const sessionId = log.args.sessionId;
              const outcome = log.args.outcome;
              if (
                !walletAddress ||
                !sessionId ||
                outcome === undefined ||
                log.args.payoutAmount === undefined ||
                log.args.finalMultiplierBp === undefined
              ) {
                return;
              }
              await ensurePlayer(walletAddress);

              await supabase
                .from("game_sessions")
                .update({
                  settlement_tx_hash: txHash(log),
                  final_multiplier: Number(log.args.finalMultiplierBp) / 10_000,
                  payout_amount: unitsToToken(log.args.payoutAmount),
                  status: outcome === 1 ? "CASHED_OUT" : "CRASHED",
                })
                .eq("wallet_address", walletAddress)
                .eq("onchain_session_id", sessionId);

              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "SESSION_SETTLED",
                amount: unitsToToken(log.args.payoutAmount),
                onchainSessionId: sessionId,
              });
            })().catch((err) => console.error("❌ Failed to handle SessionSettled event:", err));
          }
        },
      }),
    ];

    if (FAUCET_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
      unwatchers.push(
        publicClient.watchContractEvent({
          address: FAUCET_CONTRACT_ADDRESS,
          abi: FAUCET_ABI,
          eventName: "Claimed",
          onLogs: (logs) => {
            for (const log of logs) {
              void (async () => {
                const walletAddress = log.args.account;
                if (!walletAddress || log.args.amount === undefined) return;
                await ensurePlayer(walletAddress);
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "DEPOSIT",
                  amount: unitsToToken(log.args.amount),
                });
              })().catch((err) => console.error("❌ Failed to handle Faucet Claimed event:", err));
            }
          },
        }),
      );
    }

    isListening = true;
    console.log("✅ Celo event listener active");
  } catch (err) {
    console.error("❌ Failed to start Celo event listener:", err);
    console.log("   Backend will continue without blockchain events.");
  }
}

export async function stopBlockchainListener(): Promise<void> {
  for (const unwatch of unwatchers) {
    try {
      unwatch();
    } catch (err) {
      console.error("⚠️  Error removing event listener:", err);
    }
  }
  unwatchers = [];
  isListening = false;
}
