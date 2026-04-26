import { createPublicClient, http, type Address, parseAbi } from "viem";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";

const GAME_VAULT_ABI = parseAbi([
  "event Deposited(address indexed account, uint256 amount)",
  "event Withdrawn(address indexed account, uint256 amount)",
  "event TreasuryFunded(address indexed funder, uint256 amount)",
]);

const GAME_SETTLEMENT_ABI = parseAbi([
  "event SessionStarted(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount)",
  "event SessionSettled(address indexed player, bytes32 indexed sessionId, uint8 outcome, uint256 stakeAmount, uint256 payoutAmount, uint256 finalMultiplierBp)",
]);

type TransactionType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "TREASURY_FUNDED"
  | "SESSION_STARTED"
  | "SESSION_SETTLED";

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({ transport: http(env.CELO_RPC_URL) });
  }

  return publicClient;
}

async function ensurePlayer(walletAddress: string) {
  const { error } = await supabase
    .from("players")
    .upsert({ wallet_address: walletAddress.toLowerCase() }, { onConflict: "wallet_address" });

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
      wallet_address: params.walletAddress.toLowerCase(),
      type: params.type,
      amount: params.amount,
      onchain_session_id: params.onchainSessionId ?? null,
    },
    { onConflict: "tx_hash" }
  );

  if (error) {
    console.error(`❌ Failed to log transaction ${params.txHash}:`, error);
  }
}

let isListening = false;

export async function startBlockchainListener(): Promise<void> {
  if (isListening) {
    return;
  }

  const vaultAddress = env.GAME_VAULT_ADDRESS as Address;
  const settlementAddress = env.GAME_SETTLEMENT_ADDRESS as Address;

  if (
    vaultAddress === "0x0000000000000000000000000000000000000000" ||
    settlementAddress === "0x0000000000000000000000000000000000000000"
  ) {
    console.log("⚠️  Blockchain listener SKIPPED — GAME_VAULT_ADDRESS or GAME_SETTLEMENT_ADDRESS is placeholder");
    return;
  }

  const client = getPublicClient();

  try {
    console.log(`🔗 Starting blockchain listener on ${env.CELO_RPC_URL}`);
    console.log(`   Watching vault: ${vaultAddress}`);
    console.log(`   Watching settlement: ${settlementAddress}`);

    client.watchContractEvent({
      address: vaultAddress,
      abi: GAME_VAULT_ABI,
      eventName: "Deposited",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { account, amount } = log.args as { account: string; amount: bigint };
          await ensurePlayer(account);
          if (log.transactionHash) {
            await logTransaction({
              txHash: log.transactionHash,
              walletAddress: account,
              type: "DEPOSIT",
              amount: Number(amount) / 1e6,
            });
          }
        }
      },
      onError: (error) => console.error("❌ Deposited listener error:", error),
    });

    client.watchContractEvent({
      address: vaultAddress,
      abi: GAME_VAULT_ABI,
      eventName: "Withdrawn",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { account, amount } = log.args as { account: string; amount: bigint };
          await ensurePlayer(account);
          if (log.transactionHash) {
            await logTransaction({
              txHash: log.transactionHash,
              walletAddress: account,
              type: "WITHDRAW",
              amount: Number(amount) / 1e6,
            });
          }
        }
      },
      onError: (error) => console.error("❌ Withdrawn listener error:", error),
    });

    client.watchContractEvent({
      address: vaultAddress,
      abi: GAME_VAULT_ABI,
      eventName: "TreasuryFunded",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { funder, amount } = log.args as { funder: string; amount: bigint };
          await ensurePlayer(funder);
          if (log.transactionHash) {
            await logTransaction({
              txHash: log.transactionHash,
              walletAddress: funder,
              type: "TREASURY_FUNDED",
              amount: Number(amount) / 1e6,
            });
          }
        }
      },
      onError: (error) => console.error("❌ TreasuryFunded listener error:", error),
    });

    client.watchContractEvent({
      address: settlementAddress,
      abi: GAME_SETTLEMENT_ABI,
      eventName: "SessionStarted",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { player, sessionId, stakeAmount } = log.args as {
            player: string;
            sessionId: string;
            stakeAmount: bigint;
          };

          await ensurePlayer(player);

          if (log.transactionHash) {
            await logTransaction({
              txHash: log.transactionHash,
              walletAddress: player,
              type: "SESSION_STARTED",
              amount: Number(stakeAmount) / 1e6,
              onchainSessionId: sessionId.toLowerCase(),
            });
          }
        }
      },
      onError: (error) => console.error("❌ SessionStarted listener error:", error),
    });

    client.watchContractEvent({
      address: settlementAddress,
      abi: GAME_SETTLEMENT_ABI,
      eventName: "SessionSettled",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { player, sessionId, outcome, payoutAmount, finalMultiplierBp } = log.args as {
            player: string;
            sessionId: string;
            outcome: number;
            payoutAmount: bigint;
            finalMultiplierBp: bigint;
          };

          await ensurePlayer(player);

          await supabase
            .from("game_sessions")
            .update({
              settlement_tx_hash: log.transactionHash ?? null,
              final_multiplier: Number(finalMultiplierBp) / 10_000,
              payout_amount: Number(payoutAmount) / 1e6,
              status: outcome === 1 ? "CASHED_OUT" : "CRASHED",
            })
            .eq("wallet_address", player.toLowerCase())
            .eq("onchain_session_id", sessionId.toLowerCase());

          if (log.transactionHash) {
            await logTransaction({
              txHash: log.transactionHash,
              walletAddress: player,
              type: "SESSION_SETTLED",
              amount: Number(payoutAmount) / 1e6,
              onchainSessionId: sessionId.toLowerCase(),
            });
          }
        }
      },
      onError: (error) => console.error("❌ SessionSettled listener error:", error),
    });

    isListening = true;
    console.log("✅ Blockchain event listeners active");
  } catch (err) {
    console.error("❌ Failed to start blockchain listener:", err);
    console.log("   Backend will continue without blockchain events.");
  }
}
