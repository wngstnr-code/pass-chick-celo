# Pass Chick Smart Contracts

This package contains the backend-authoritative onchain flow for Pass Chick on Celo.
All contracts are deployed as UUPS proxies (`ERC1967Proxy` + separate implementations).

The repo now supports two deploy tracks:

- `script/DeployGameContracts.s.sol`: Celo Sepolia demo stack with mock `GameUSDC` and `USDCFaucet`
- `script/DeployMainnetGameContracts.s.sol`: Celo Mainnet stack with real USDC, no mock token, no faucet

## Contract Layout

Core contracts used on both networks:

- `GameVault`: custody layer for available, locked, and treasury balances
- `GameSettlement`: session manager that verifies backend EIP-712 signatures
- `TrustPassport`: onchain credential for anti-bot / proof-of-human style flows

Demo-only contracts used on Sepolia:

- `GameUSDC`: mock USDC with 6 decimals
- `USDCFaucet`: testnet bootstrap faucet

## Core Contract Summary

### GameVault

- Users `approve` USDC and then call `deposit(amount)`
- Tracks `available`, `locked`, and `treasury` balances separately
- Users can only `withdraw(amount)` from their available balance
- `fundTreasury(amount)` is used to bootstrap payout liquidity
- Owner can withdraw treasury funds and rescue stray tokens
- Only `GameSettlement` can lock stake and settle outcomes
- Upgradeable through UUPS

### GameSettlement

- `startSession(bytes32 onchainSessionId, uint256 stakeAmount)` locks stake in the vault
- One wallet can only have one active session at a time
- `settleWithSignature(...)` verifies backend EIP-712 settlement payloads
- `expireSession(bytes32 sessionId)` closes stale sessions as `CRASHED`
- Fixed live stake is enforced onchain at `0.0001 USDC`
- Owner can `pause()` and `unpause()`
- `sessionExpiryDelay` is configurable
- Upgradeable through UUPS

### TrustPassport

- Stores signed backend-issued passport claims onchain
- Binds each claim to the player wallet at mint time
- Supports tiered trust / proof-of-human style flows
- Upgradeable through UUPS

## Prerequisites

- Foundry installed
- a Celo RPC URL for the target network
- a deployer private key for broadcasts
- a backend signer wallet address

For mainnet, you also need the real Celo USDC token address in `USDC_ADDRESS`.

## Bootstrap

Install the pinned dependencies from `foundry.lock`:

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.6.1
forge install foundry-rs/forge-std@v1.15.0
```

## Environment

Use `sc/.env.example` as the template for both networks.

Mainnet values:

```bash
CELO_RPC_URL=https://forno.celo.org
PRIVATE_KEY=0xyour_private_key
CELOSCAN_API_KEY=your_celoscan_api_key
USDC_ADDRESS=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
INITIAL_OWNER=0xyour_owner_address
BACKEND_SIGNER=0xyour_backend_signer_address
SESSION_EXPIRY_DELAY=86400
```

Sepolia demo values:

```bash
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
USDC_FAUCET_CLAIM_AMOUNT=100000000
```

Minimum required values for mainnet deployment are:

- `CELO_RPC_URL`
- `PRIVATE_KEY`
- `USDC_ADDRESS`

Other useful values:

- `INITIAL_OWNER`
- `BACKEND_SIGNER`
- `GAME_VAULT_ADDRESS`
- `GAME_SETTLEMENT_ADDRESS`
- `TRUST_PASSPORT_ADDRESS`
- `NEW_BACKEND_SIGNER`
- `CELOSCAN_API_KEY`

## Commands

### Build

```bash
forge build
```

### Build for source verification

```bash
FOUNDRY_PROFILE=source_verify forge build
```

### Test

```bash
forge test --offline
```

### Format

```bash
forge fmt
```

## Deploy to Celo Mainnet

Use this path when you want real USDC, no faucet, and no mock token deployment.

### Standard deploy

```bash
source .env
forge script script/DeployMainnetGameContracts.s.sol:DeployMainnetGameContracts --rpc-url celo --broadcast
```

### Source-verification-friendly deploy

```bash
source .env
FOUNDRY_PROFILE=source_verify forge script script/DeployMainnetGameContracts.s.sol:DeployMainnetGameContracts --rpc-url celo --broadcast
```

The mainnet deploy script:

- deploys implementations for `GameVault`, `GameSettlement`, and `TrustPassport`
- deploys UUPS proxies
- wires `GameSettlement` into `GameVault`
- reuses the existing Celo Mainnet USDC token from `USDC_ADDRESS`
- prints the frontend-facing addresses

Frontend-facing outputs:

```bash
NEXT_PUBLIC_USDC_ADDRESS=<mainnet_usdc_address>
NEXT_PUBLIC_USDC_FAUCET_ADDRESS=
NEXT_PUBLIC_GAME_VAULT_ADDRESS=<deployed_game_vault>
NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=<deployed_game_settlement>
NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=<deployed_trust_passport>
```

## Deploy to Celo Sepolia

Use this path for demo flows that still need a mock token and faucet.

```bash
source .env
forge script script/DeployGameContracts.s.sol:DeployGameContracts --rpc-url celo_sepolia --broadcast
```

For source-verification-friendly Sepolia deploys:

```bash
source .env
FOUNDRY_PROFILE=source_verify forge script script/DeployGameContracts.s.sol:DeployGameContracts --rpc-url celo_sepolia --broadcast
```

## Verification

Official Celo docs list:

- Celo Mainnet chain ID `42220`
- Celo Mainnet Forno RPC `https://forno.celo.org`
- explorers `https://explorer.celo.org` and `https://celoscan.io`
- Celo Sepolia chain ID `11142220`
- Celo Sepolia Forno RPC `https://forno.celo-sepolia.celo-testnet.org`
- Celo Sepolia explorer `https://celo-sepolia.blockscout.com`

### Verify on CeloScan with Foundry

Mainnet:

```bash
source .env
forge verify-contract \
  --chain-id 42220 \
  <contract_address> \
  <contract_name> \
  --etherscan-api-key "$CELOSCAN_API_KEY" \
  --watch
```

Sepolia:

```bash
source .env
forge verify-contract \
  --chain-id 11142220 \
  <contract_address> \
  <contract_name> \
  --etherscan-api-key "$CELOSCAN_API_KEY" \
  --watch
```

Examples for `<contract_name>`:

- `src/GameVault.sol:GameVault`
- `src/GameSettlement.sol:GameSettlement`
- `src/TrustPassport.sol:TrustPassport`
- `src/GameUSDC.sol:GameUSDC`
- `src/USDCFaucet.sol:USDCFaucet`

## Rotate Backend Signer

After deployment:

Mainnet:

```bash
source .env
forge script script/UpdateBackendSigner.s.sol:UpdateBackendSigner --rpc-url celo --broadcast
```

Sepolia:

```bash
source .env
forge script script/UpdateBackendSigner.s.sol:UpdateBackendSigner --rpc-url celo_sepolia --broadcast
```

Use the owner key for the target contracts.

## Treasury Bootstrap

Mainnet deploy only creates the contracts. It does not preload payout liquidity.

After deployment, fund the treasury through `GameVault.fundTreasury(amount)` using the admin wallet that holds USDC.
Do not transfer USDC directly to the vault without calling `fundTreasury`, because `treasuryBalance` must stay in sync with the token balance.

## Backend-Authoritative Flow

1. The user approves USDC and deposits into the vault.
2. The backend creates an `onchain_session_id`.
3. The frontend calls `GameSettlement.startSession(...)`.
4. The backend validates the game result offchain and signs a settlement payload.
5. The frontend or backend relayer submits settlement onchain.
6. Cashouts move value back into the user's available vault balance.
7. Crashes route stake into treasury.
