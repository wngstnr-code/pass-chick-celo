"use client";

import { useMemo, useState } from "react";
import { useWallet } from "~/components/web3/WalletProvider";
import { BACKEND_API_URL, hasBackendApiConfig } from "~/lib/backend/config";
import type { DepositFlowViewModel } from "./types";

export function useBackendDepositFlow(): DepositFlowViewModel {
  const { account, isMiniPay, isCeloChain } = useWallet();
  const [amount, setAmount] = useState("10");

  const isConnected = Boolean(account);
  const hasBackendConfig = hasBackendApiConfig();
  const configMessage = useMemo(() => {
    if (!hasBackendConfig) {
      return "Backend mode is enabled but `NEXT_PUBLIC_BACKEND_API_URL` is not set.";
    }
    return "Mode backend siap. Tinggal sambungkan endpoint approve/deposit dari tim backend.";
  }, [hasBackendConfig]);

  return {
    source: "backend",
    amount,
    setAmount,
    statusMessage: "",
    errorMessage: "",
    isConnected,
    isMiniPay,
    isCeloChain,
    canTransact: false,
    hasValidContracts: hasBackendConfig,
    usdcAddress: "",
    vaultAddress: "",
    walletBalanceDisplay: "-",
    allowanceDisplay: "-",
    availableBalanceDisplay: "-",
    lockedBalanceDisplay: "-",
    isWalletBalanceFetching: false,
    isAllowanceFetching: false,
    isVaultBalanceFetching: false,
    needsApproval: false,
    approveTxHash: "",
    approveTxUrl: "",
    depositTxHash: "",
    depositTxUrl: "",
    withdrawTxHash: "",
    withdrawTxUrl: "",
    isApproveBusy: false,
    isDepositBusy: false,
    isWithdrawBusy: false,
    disableApproveButton: true,
    disableDepositButton: true,
    disableWithdrawButton: true,
    onApprove: async () => {
      throw new Error(
        `Backend mode is not implemented yet. Set endpoint in ${BACKEND_API_URL || "frontend/.env.local"}.`
      );
    },
    onDeposit: async () => {
      throw new Error(
        `Backend mode is not implemented yet. Set endpoint in ${BACKEND_API_URL || "frontend/.env.local"}.`
      );
    },
    onWithdraw: async () => {
      throw new Error(
        `Backend mode is not implemented yet. Set endpoint in ${BACKEND_API_URL || "frontend/.env.local"}.`
      );
    },
    configMessage,
  };
}
