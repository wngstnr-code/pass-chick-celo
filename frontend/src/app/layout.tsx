import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Web3Provider } from "~/components/web3/Web3Provider";
import { WalletProvider } from "~/components/web3/WalletProvider";

export const metadata: Metadata = {
  title: "Pass Chick | Celo Sepolia Demo",
  description: "Pass Chick game with mock betting HUD on Next.js.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>
          <WalletProvider>{children}</WalletProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
