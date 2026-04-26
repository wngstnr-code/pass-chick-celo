import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";

const DEPOSITED_EVENT = parseAbiItem("event Deposited(address indexed account, uint256 amount)");
const WITHDRAWN_EVENT = parseAbiItem("event Withdrawn(address indexed account, uint256 amount)");
const TREASURY_FUNDED_EVENT = parseAbiItem(
  "event TreasuryFunded(address indexed funder, uint256 amount)"
);
const SESSION_STARTED_EVENT = parseAbiItem(
  "event SessionStarted(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount)"
);
const SESSION_SETTLED_EVENT = parseAbiItem(
  "event SessionSettled(address indexed player, bytes32 indexed sessionId, uint8 outcome, uint256 stakeAmount, uint256 payoutAmount, uint256 finalMultiplierBp)"
);

type TransactionType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "TREASURY_FUNDED"
  | "SESSION_STARTED"
  | "SESSION_SETTLED";

const EVENT_POLL_INTERVAL_MS = 15_000;

let publicClient: ReturnType<typeof createPublicClient> | null = null;
let isListening = false;
let lastProcessedBlock: bigint | null = null;

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

async function syncVaultEventRange(vaultAddress: Address, fromBlock: bigint, toBlock: bigint) {
  const client = getPublicClient();

  const [deposits, withdrawals, treasuryFunded] = await Promise.all([
    client.getLogs({
      address: vaultAddress,
      event: DEPOSITED_EVENT,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: vaultAddress,
      event: WITHDRAWN_EVENT,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: vaultAddress,
      event: TREASURY_FUNDED_EVENT,
      fromBlock,
      toBlock,
    }),
  ]);

  for (const log of deposits) {
    const { account, amount } = log.args;
    if (!account || amount === undefined) continue;
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

  for (const log of withdrawals) {
    const { account, amount } = log.args;
    if (!account || amount === undefined) continue;
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

  for (const log of treasuryFunded) {
    const { funder, amount } = log.args;
    if (!funder || amount === undefined) continue;
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
}

async function syncSettlementEventRange(settlementAddress: Address, fromBlock: bigint, toBlock: bigint) {
  const client = getPublicClient();

  const [sessionStarted, sessionSettled] = await Promise.all([
    client.getLogs({
      address: settlementAddress,
      event: SESSION_STARTED_EVENT,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: settlementAddress,
      event: SESSION_SETTLED_EVENT,
      fromBlock,
      toBlock,
    }),
  ]);

  for (const log of sessionStarted) {
    const { player, sessionId, stakeAmount } = log.args;
    if (!player || !sessionId || stakeAmount === undefined) continue;

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

  for (const log of sessionSettled) {
    const { player, sessionId, outcome, payoutAmount, finalMultiplierBp } = log.args;
    if (!player || !sessionId || outcome === undefined || payoutAmount === undefined || finalMultiplierBp === undefined) {
      continue;
    }

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
}

async function syncBlockRange(vaultAddress: Address, settlementAddress: Address, fromBlock: bigint, toBlock: bigint) {
  if (fromBlock > toBlock) {
    return;
  }

  await Promise.all([
    syncVaultEventRange(vaultAddress, fromBlock, toBlock),
    syncSettlementEventRange(settlementAddress, fromBlock, toBlock),
  ]);
}

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

    const currentBlock = await client.getBlockNumber();
    lastProcessedBlock = currentBlock;

    client.watchBlockNumber({
      poll: true,
      pollingInterval: EVENT_POLL_INTERVAL_MS,
      emitOnBegin: false,
      emitMissed: true,
      onBlockNumber: async (blockNumber) => {
        const fromBlock = lastProcessedBlock === null ? blockNumber : lastProcessedBlock + 1n;
        lastProcessedBlock = blockNumber;

        try {
          await syncBlockRange(vaultAddress, settlementAddress, fromBlock, blockNumber);
        } catch (error) {
          console.error("❌ Blockchain sync error:", error);
        }
      },
      onError: (error) => {
        console.error("❌ Block watcher error:", error);
      },
    });

    isListening = true;
    console.log("✅ Blockchain event listeners active");
  } catch (err) {
    console.error("❌ Failed to start blockchain listener:", err);
    console.log("   Backend will continue without blockchain events.");
  }
}
