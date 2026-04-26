// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";
import {GameVault} from "../src/GameVault.sol";
import {GameSettlement} from "../src/GameSettlement.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

contract DeployGameContracts is Script {
    uint256 internal constant DEFAULT_FAUCET_CLAIM_AMOUNT = 100 * 1e6;
    uint64 internal constant DEFAULT_SESSION_EXPIRY_DELAY = 1 days;

    struct DeployConfig {
        uint256 privateKey;
        uint256 claimAmount;
        address initialOwner;
        address backendSigner;
        uint64 sessionExpiryDelay;
    }

    struct DeploymentAddresses {
        address tokenImplementation;
        address faucetImplementation;
        address vaultImplementation;
        address settlementImplementation;
        address passportImplementation;
        address tokenProxy;
        address faucetProxy;
        address vaultProxy;
        address settlementProxy;
        address passportProxy;
    }

    function run()
        external
        returns (
            GameUSDC token,
            USDCFaucet faucet,
            GameVault vault,
            GameSettlement settlement,
            TrustPassport passport
        )
    {
        DeployConfig memory config = _loadConfig();
        DeploymentAddresses memory deployments;

        _startBroadcast(config.privateKey);
        config.initialOwner = _resolveInitialOwner(config.privateKey, config.initialOwner);
        if (config.backendSigner == address(0)) {
            config.backendSigner = config.initialOwner;
        }

        (token, deployments.tokenImplementation, deployments.tokenProxy) = _deployToken(config.initialOwner);
        (faucet, deployments.faucetImplementation, deployments.faucetProxy) =
            _deployFaucet(config.initialOwner, address(token), config.claimAmount);
        (vault, deployments.vaultImplementation, deployments.vaultProxy) =
            _deployVault(config.initialOwner, address(token));
        (settlement, deployments.settlementImplementation, deployments.settlementProxy) = _deploySettlement(
            config.initialOwner, address(vault), config.backendSigner, config.sessionExpiryDelay
        );
        (passport, deployments.passportImplementation, deployments.passportProxy) =
            _deployPassport(config.initialOwner, config.backendSigner);

        token.setMinter(address(faucet), true);
        vault.setSettlement(address(settlement));

        vm.stopBroadcast();

        _logDeployment(config, deployments);
    }

    function _loadConfig() internal view returns (DeployConfig memory config) {
        config.privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        config.claimAmount = vm.envOr("USDC_FAUCET_CLAIM_AMOUNT", DEFAULT_FAUCET_CLAIM_AMOUNT);
        config.initialOwner = vm.envOr("INITIAL_OWNER", address(0));
        config.backendSigner = vm.envOr("BACKEND_SIGNER", address(0));
        config.sessionExpiryDelay = uint64(vm.envOr("SESSION_EXPIRY_DELAY", uint256(DEFAULT_SESSION_EXPIRY_DELAY)));
    }

    function _startBroadcast(uint256 privateKey) internal {
        if (privateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(privateKey);
        }
    }

    function _resolveInitialOwner(uint256 privateKey, address initialOwner) internal returns (address) {
        if (initialOwner != address(0)) {
            return initialOwner;
        }

        (, address broadcaster,) = vm.readCallers();
        if (privateKey == 0) {
            return broadcaster;
        }

        return vm.addr(privateKey);
    }

    function _deployToken(address initialOwner)
        internal
        returns (GameUSDC token, address implementation, address proxy)
    {
        GameUSDC tokenImplementation = new GameUSDC();
        GameUSDC tokenProxy =
            GameUSDC(address(new ERC1967Proxy(address(tokenImplementation), abi.encodeCall(GameUSDC.initialize, (initialOwner)))));

        return (tokenProxy, address(tokenImplementation), address(tokenProxy));
    }

    function _deployFaucet(address initialOwner, address token, uint256 claimAmount)
        internal
        returns (USDCFaucet faucet, address implementation, address proxy)
    {
        USDCFaucet faucetImplementation = new USDCFaucet();
        USDCFaucet faucetProxy = USDCFaucet(
            address(
                new ERC1967Proxy(
                    address(faucetImplementation),
                    abi.encodeCall(USDCFaucet.initialize, (initialOwner, token, claimAmount))
                )
            )
        );

        return (faucetProxy, address(faucetImplementation), address(faucetProxy));
    }

    function _deployVault(address initialOwner, address token)
        internal
        returns (GameVault vault, address implementation, address proxy)
    {
        GameVault vaultImplementation = new GameVault();
        GameVault vaultProxy = GameVault(
            address(
                new ERC1967Proxy(address(vaultImplementation), abi.encodeCall(GameVault.initialize, (initialOwner, token)))
            )
        );

        return (vaultProxy, address(vaultImplementation), address(vaultProxy));
    }

    function _deploySettlement(address initialOwner, address vault, address backendSigner, uint64 sessionExpiryDelay)
        internal
        returns (GameSettlement settlement, address implementation, address proxy)
    {
        GameSettlement settlementImplementation = new GameSettlement();
        GameSettlement settlementProxy = GameSettlement(
            address(
                new ERC1967Proxy(
                    address(settlementImplementation),
                    abi.encodeCall(
                        GameSettlement.initialize, (initialOwner, vault, backendSigner, sessionExpiryDelay)
                    )
                )
            )
        );

        return (settlementProxy, address(settlementImplementation), address(settlementProxy));
    }

    function _deployPassport(address initialOwner, address backendSigner)
        internal
        returns (TrustPassport passport, address implementation, address proxy)
    {
        TrustPassport passportImplementation = new TrustPassport();
        TrustPassport passportProxy = TrustPassport(
            address(
                new ERC1967Proxy(
                    address(passportImplementation),
                    abi.encodeCall(TrustPassport.initialize, (initialOwner, backendSigner))
                )
            )
        );

        return (passportProxy, address(passportImplementation), address(passportProxy));
    }

    function _logDeployment(DeployConfig memory config, DeploymentAddresses memory deployments) internal view {
        console2.log("Owner:", config.initialOwner);
        console2.log("Backend signer:", config.backendSigner);
        console2.log("Session expiry delay:", config.sessionExpiryDelay);
        console2.log("GameUSDC implementation:", deployments.tokenImplementation);
        console2.log("USDCFaucet implementation:", deployments.faucetImplementation);
        console2.log("GameVault implementation:", deployments.vaultImplementation);
        console2.log("GameSettlement implementation:", deployments.settlementImplementation);
        console2.log("TrustPassport implementation:", deployments.passportImplementation);
        console2.log("GameUSDC proxy:", deployments.tokenProxy);
        console2.log("USDCFaucet proxy:", deployments.faucetProxy);
        console2.log("GameVault proxy:", deployments.vaultProxy);
        console2.log("GameSettlement proxy:", deployments.settlementProxy);
        console2.log("TrustPassport proxy:", deployments.passportProxy);
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=%s", deployments.tokenProxy);
        console2.log("NEXT_PUBLIC_USDC_FAUCET_ADDRESS=%s", deployments.faucetProxy);
        console2.log("NEXT_PUBLIC_GAME_VAULT_ADDRESS=%s", deployments.vaultProxy);
        console2.log("NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=%s", deployments.settlementProxy);
        console2.log("NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=%s", deployments.passportProxy);
    }
}
