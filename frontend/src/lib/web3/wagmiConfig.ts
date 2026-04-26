import type { Chain } from "viem";
import { celoSepolia } from "viem/chains";
import { CELO_CHAIN } from "./celo";

const FALLBACK_CHAIN_ID = celoSepolia.id;
const FALLBACK_RPC_URL = celoSepolia.rpcUrls.default.http[0] || "";
const FALLBACK_EXPLORER_URL = celoSepolia.blockExplorers.default.url;

function buildCeloWagmiChain(): Chain {
  const chainId =
    CELO_CHAIN.chainIdDecimal > 0 ? CELO_CHAIN.chainIdDecimal : FALLBACK_CHAIN_ID;
  const rpcUrl = CELO_CHAIN.rpcUrls[0] || FALLBACK_RPC_URL;
  const explorerUrl = CELO_CHAIN.blockExplorerUrls[0] || FALLBACK_EXPLORER_URL;

  return {
    id: chainId,
    name: CELO_CHAIN.chainName || celoSepolia.name,
    nativeCurrency: {
      name: CELO_CHAIN.nativeCurrency.name,
      symbol: CELO_CHAIN.nativeCurrency.symbol,
      decimals: CELO_CHAIN.nativeCurrency.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: explorerUrl
      ? {
          default: {
            name: "Celo Explorer",
            url: explorerUrl,
          },
        }
      : undefined,
    testnet: true,
  };
}

export const celoWagmiChain = buildCeloWagmiChain();

export const appKitNetworks: [Chain, ...Chain[]] = [celoWagmiChain];

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "demo-project-id";

export const appKitMetadata = {
  name: "Pass Chick",
  description: "Crossy chicken game with mock betting HUD on Celo Sepolia.",
  url: "http://localhost:3000",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};
