"use client";

import type { DepositDataSource, DepositFlowViewModel } from "./types";
import { useBackendDepositFlow } from "./useBackendDepositFlow";
import { useOnchainDepositFlow } from "./useOnchainDepositFlow";

function readDepositDataSource(): DepositDataSource {
  const value = (process.env.NEXT_PUBLIC_DEPOSIT_DATA_SOURCE || "onchain").toLowerCase();
  return value === "backend" ? "backend" : "onchain";
}

const dataSource = readDepositDataSource();
const useDepositFlowImpl =
  dataSource === "backend" ? useBackendDepositFlow : useOnchainDepositFlow;

export function useDepositFlow(): DepositFlowViewModel {
  return useDepositFlowImpl();
}
