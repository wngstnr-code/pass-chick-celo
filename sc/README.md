# Pass Chick Smart Contracts

This package contains the backend-authoritative onchain flow for Pass Chick on Celo Sepolia.
All contracts are deployed as UUPS proxies (`ERC1967Proxy` + separate implementations).

Included contracts:

- `GameUSDC`: mock USDC with 6 decimals
- `USDCFaucet`: testnet bootstrap faucet
- `GameVault`: custody layer for available, locked, and treasury balances
- `GameSettlement`: session manager that verifies backend EIP-712 signatures
- `TrustPassport`: onchain credential for anti-bot / proof-of-human style flows

## Contract Summary

### GameUSDC

- Name: `Mock USD Coin`
- Symbol: `USDC`
- Decimals: `6`
- No initial supply
- Only approved minters can call `mint`
- Upgradeable through UUPS

### USDCFaucet

- `claim()` mints `100 * 10^6` to the caller
- No cooldown
- Owner can `pause`, `unpause`, and `setClaimAmount`
- Upgradeable through UUPS

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
- Owner can `pause()` and `unpause()`
- `sessionExpiryDelay` is configurable
- Upgradeable through UUPS

## Prerequisites

- Foundry installed
- a Celo Sepolia RPC URL
- a deployer private key for broadcasts

## Bootstrap

Install the pinned dependencies from `foundry.lock`:

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.6.1
forge install foundry-rs/forge-std@v1.15.0
```

## Environment

Set values in `sc/.env`:

```bash
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
PRIVATE_KEY=0xyour_private_key
CELOSCAN_API_KEY=your_celoscan_api_key
INITIAL_OWNER=0xyour_owner_address
USDC_FAUCET_CLAIM_AMOUNT=100000000
BACKEND_SIGNER=0xyour_backend_signer_address
SESSION_EXPIRY_DELAY=86400
```

Minimum required values for deployment are:

- `CELO_SEPOLIA_RPC_URL`
- `PRIVATE_KEY`

Other useful values:

- `INITIAL_OWNER`
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

## Deploy to Celo Sepolia

### Standard deploy

```bash
source .env
forge script script/DeployGameContracts.s.sol:DeployGameContracts --rpc-url celo_sepolia --broadcast
```

### Source-verification-friendly deploy

```bash
source .env
FOUNDRY_PROFILE=source_verify forge script script/DeployGameContracts.s.sol:DeployGameContracts --rpc-url celo_sepolia --broadcast
```

The deploy script:

- deploys implementations for `GameUSDC`, `USDCFaucet`, `GameVault`, `GameSettlement`, and `TrustPassport`
- deploys UUPS proxies
- grants the faucet token minting rights
- sets `GameSettlement` as the authorized vault settlement operator
- prints the deployed addresses

Frontend-facing proxy outputs:

```bash
NEXT_PUBLIC_USDC_ADDRESS=<deployed_game_usdc>
NEXT_PUBLIC_USDC_FAUCET_ADDRESS=<deployed_usdc_faucet>
NEXT_PUBLIC_GAME_VAULT_ADDRESS=<deployed_game_vault>
NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=<deployed_game_settlement>
NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=<deployed_trust_passport>
```

## Verification

Official Celo docs list Celo Sepolia with chain ID `11142220`, the public Forno RPC at `https://forno.celo-sepolia.celo-testnet.org`, and Blockscout at `https://celo-sepolia.blockscout.com`.

### Verify on CeloScan with Foundry

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

- `src/GameUSDC.sol:GameUSDC`
- `src/USDCFaucet.sol:USDCFaucet`
- `src/GameVault.sol:GameVault`
- `src/GameSettlement.sol:GameSettlement`
- `src/TrustPassport.sol:TrustPassport`

### Verify via Blockscout UI

Use the Celo Sepolia explorer:

```bash
https://celo-sepolia.blockscout.com
```

## Rotate Backend Signer

To update the backend signer after deployment:

```bash
source .env
forge script script/UpdateBackendSigner.s.sol:UpdateBackendSigner --rpc-url celo_sepolia --broadcast
```

Use the owner key for the target contracts.

## Backend-Authoritative Flow

1. The user approves USDC and deposits into the vault.
2. The backend creates an `onchain_session_id`.
3. The frontend calls `GameSettlement.startSession(...)`.
4. The backend validates the game result offchain and signs a settlement payload.
5. The frontend or backend relayer submits settlement onchain.
6. Cashouts move value back into the user's available vault balance.
7. Crashes route stake into treasury.
