import { createPublicClient, formatEther, http } from "viem";
import { env } from "../config/env.js";
import { getSettlementRelayerAddress } from "./settlementExecutor.js";

const BACKEND_SIGNER_MIN_CELO_BALANCE = 0.05;

const opsPublicClient = createPublicClient({
  transport: http(env.CELO_RPC_URL),
});

export async function readBackendSignerHealth() {
  const relayerAddress = getSettlementRelayerAddress();
  const balanceWei = await opsPublicClient.getBalance({
    address: relayerAddress,
  });
  const balanceCelo = Number(formatEther(balanceWei));

  return {
    relayerAddress,
    balanceWei: balanceWei.toString(),
    balanceCelo,
    healthy: balanceCelo >= BACKEND_SIGNER_MIN_CELO_BALANCE,
    minRecommendedCelo: BACKEND_SIGNER_MIN_CELO_BALANCE,
  };
}
