import { celoSepolia } from "viem/chains";

type NativeCurrency = {
  name: string;
  symbol: string;
  decimals: number;
};

export type CeloChainConfig = {
  chainIdHex: string;
  chainIdDecimal: number;
  chainName: string;
  nativeCurrency: NativeCurrency;
  rpcUrls: string[];
  blockExplorerUrls: string[];
};

function splitList(rawValue: string) {
  if (!rawValue) return [];
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseChainId(rawValue: string) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return {
      chainIdHex: `0x${celoSepolia.id.toString(16)}`,
      chainIdDecimal: celoSepolia.id,
    };
  }

  const parsed = normalized.startsWith("0x")
    ? Number.parseInt(normalized, 16)
    : Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      chainIdHex: `0x${celoSepolia.id.toString(16)}`,
      chainIdDecimal: celoSepolia.id,
    };
  }

  return {
    chainIdHex: `0x${parsed.toString(16)}`,
    chainIdDecimal: parsed,
  };
}

const parsedChainId = parseChainId(process.env.NEXT_PUBLIC_CELO_CHAIN_ID || "");
const chainName = process.env.NEXT_PUBLIC_CELO_CHAIN_NAME || celoSepolia.name;
const nativeCurrencyName =
  process.env.NEXT_PUBLIC_CELO_NATIVE_NAME || celoSepolia.nativeCurrency.name;
const nativeCurrencySymbol =
  process.env.NEXT_PUBLIC_CELO_NATIVE_SYMBOL ||
  celoSepolia.nativeCurrency.symbol;
const nativeCurrencyDecimals = Number(
  process.env.NEXT_PUBLIC_CELO_NATIVE_DECIMALS ||
    String(celoSepolia.nativeCurrency.decimals),
);
const envRpcUrls = splitList(process.env.NEXT_PUBLIC_CELO_RPC_URLS || "");
const envBlockExplorerUrls = splitList(
  process.env.NEXT_PUBLIC_CELO_EXPLORER_URLS || "",
);

export const CELO_CHAIN: CeloChainConfig = {
  chainIdHex: parsedChainId.chainIdHex,
  chainIdDecimal: parsedChainId.chainIdDecimal,
  chainName,
  nativeCurrency: {
    name: nativeCurrencyName,
    symbol: nativeCurrencySymbol,
    decimals: Number.isFinite(nativeCurrencyDecimals)
      ? nativeCurrencyDecimals
      : celoSepolia.nativeCurrency.decimals,
  },
  rpcUrls:
    envRpcUrls.length > 0 ? envRpcUrls : [...celoSepolia.rpcUrls.default.http],
  blockExplorerUrls:
    envBlockExplorerUrls.length > 0
      ? envBlockExplorerUrls
      : celoSepolia.blockExplorers?.default?.url
        ? [celoSepolia.blockExplorers.default.url]
        : [],
};

export function hasCeloChainConfig() {
  return Boolean(
    CELO_CHAIN.chainIdHex &&
      CELO_CHAIN.chainIdDecimal > 0 &&
      CELO_CHAIN.chainName &&
      CELO_CHAIN.rpcUrls.length > 0 &&
      CELO_CHAIN.nativeCurrency.symbol,
  );
}

export function explorerTxUrl(hash: string) {
  if (!hash) return "";
  const baseUrl = CELO_CHAIN.blockExplorerUrls[0];
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/tx/${hash}`;
}
