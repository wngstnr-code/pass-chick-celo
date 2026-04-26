declare module "*.css";

type ChickenBridgeSettlementResolution = {
  sessionId: string;
  player: string;
  stakeAmount: string;
  payoutAmount: string;
  finalMultiplierBp: string;
  outcome: number;
  deadline: string;
};

type ChickenBridgeStartResult = {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  availableBalance: number;
  txHash: string;
};

type ChickenBridgeSettlementResult = {
  sessionId: string;
  onchainSessionId: string;
  availableBalance: number;
  txHash: string;
  resolution: ChickenBridgeSettlementResolution;
  signature: string;
  multiplier: number;
  payoutAmount: number;
  profit: number;
  reason?: string;
};

type ChickenBridgeDepositResult = {
  approveTxHash?: string;
  depositTxHash: string;
  availableBalance: number;
};

type ChickenBridgeDepositBalances = {
  walletBalance: number;
  availableBalance: number;
  lockedBalance: number;
  allowance: number;
};

type ChickenBridgeLeaderboardEntry = {
  wallet_address: string;
  best_score?: number;
  max_row_reached?: number;
  games_played?: number;
  best_multiplier?: number;
};

type ChickenBridgeLeaderboardPayload = {
  leaderboard: ChickenBridgeLeaderboardEntry[];
  walletAddress: string;
};

type ChickenBridgePlayerStats = {
  wallet_address: string;
  total_games: number | string | null;
  total_wins: number | string | null;
  total_losses: number | string | null;
  total_profit: number | string | null;
  created_at: string | null;
};

type ChickenBridgeGameHistorySession = {
  session_id: string;
  onchain_session_id: string;
  wallet_address: string;
  stake_amount: number | string | null;
  status: string | null;
  max_row_reached: number | string | null;
  final_multiplier: number | string | null;
  payout_amount: number | string | null;
  settlement_signature?: string | null;
  settlement_deadline?: string | null;
  settlement_tx_hash?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
};

type ChickenBridgeGameHistoryPayload = {
  sessions: ChickenBridgeGameHistorySession[];
  total: number;
  limit: number;
  offset: number;
};

type ChickenBridgePlayerTransaction = {
  tx_hash: string;
  wallet_address: string;
  type: string | null;
  onchain_session_id?: string | null;
  amount: number | string | null;
  created_at?: string | null;
};

type ChickenBridgePlayerTransactionsPayload = {
  transactions: ChickenBridgePlayerTransaction[];
  total: number;
  limit: number;
  offset: number;
};

type ChickenBridgePlayBlocker =
  | {
      kind: "none";
    }
  | {
      kind: "pending_settlement" | "active_previous";
      message: string;
      actionLabel: string;
      onchainSessionId?: string;
      pendingCount?: number;
    };

type ChickenBridgePassportEligibility = {
  eligible: boolean;
  tier: number;
  reason: string;
  stats: {
    runsEvaluated: number;
    bestHops: number;
    averageHops: number;
  };
};

type ChickenBridgePassportOnchainStatus = {
  configured: boolean;
  valid: boolean;
  tier: number;
  issuedAt: number;
  expiry: number;
  revoked: boolean;
};

type ChickenBridgePassportStatus = {
  walletAddress: string;
  eligibility: ChickenBridgePassportEligibility;
  passport: ChickenBridgePassportOnchainStatus;
};

type ChickenBridgeApi = {
  backgroundMode: boolean;
  loadAvailableBalance: () => Promise<number>;
  loadDepositBalances: () => Promise<ChickenBridgeDepositBalances>;
  loadLeaderboard: () => Promise<ChickenBridgeLeaderboardPayload>;
  loadPlayerStats: () => Promise<ChickenBridgePlayerStats>;
  loadGameHistory: (limit?: number) => Promise<ChickenBridgeGameHistoryPayload>;
  loadPlayerTransactions: (
    limit?: number,
  ) => Promise<ChickenBridgePlayerTransactionsPayload>;
  getWalletAddress: () => string;
  openDeposit: (presetAmount?: number) => void;
  depositToVault: (amount: number | string) => Promise<ChickenBridgeDepositResult>;
  startBet: (stake: number) => Promise<ChickenBridgeStartResult>;
  sendMove: (direction: string) => void;
  cashOut: () => Promise<ChickenBridgeSettlementResult>;
  crash: (reason?: string) => Promise<ChickenBridgeSettlementResult | null>;
  autoSettlePending: () => Promise<boolean>;
  getPlayBlocker: () => Promise<ChickenBridgePlayBlocker>;
  resolvePlayBlocker: () => Promise<boolean>;
  getPassportStatus: () => Promise<ChickenBridgePassportStatus>;
  claimPassport: () => Promise<{
    txHash: string;
    tier: number;
    expiry: number;
    signatureExpiry: number;
  }>;
};

interface Window {
  __CHICKEN_GAME_BRIDGE__?: ChickenBridgeApi;
}
