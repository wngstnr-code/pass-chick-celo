// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameVault} from "../src/GameVault.sol";
import {GameSettlement} from "../src/GameSettlement.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

contract DeployMainnetGameContracts is Script {
    uint64 internal constant DEFAULT_SESSION_EXPIRY_DELAY = 1 days;

    struct DeployConfig {
        uint256 privateKey;
        address initialOwner;
        address backendSigner;
        address usdc;
        uint64 sessionExpiryDelay;
    }

    struct DeploymentAddresses {
        address vaultImplementation;
        address settlementImplementation;
        address passportImplementation;
        address vaultProxy;
        address settlementProxy;
        address passportProxy;
    }

    function run() external returns (GameVault vault, GameSettlement settlement, TrustPassport passport) {
        DeployConfig memory config = _loadConfig();
        DeploymentAddresses memory deployments;

        _startBroadcast(config.privateKey);
        config.initialOwner = _resolveInitialOwner(config.privateKey, config.initialOwner);
        if (config.backendSigner == address(0)) {
            config.backendSigner = config.initialOwner;
        }

        (vault, deployments.vaultImplementation, deployments.vaultProxy) =
            _deployVault(config.initialOwner, config.usdc);
        (settlement, deployments.settlementImplementation, deployments.settlementProxy) =
            _deploySettlement(config.initialOwner, address(vault), config.backendSigner, config.sessionExpiryDelay);
        (passport, deployments.passportImplementation, deployments.passportProxy) =
            _deployPassport(config.initialOwner, config.backendSigner);

        vault.setSettlement(address(settlement));

        vm.stopBroadcast();

        _logDeployment(config, deployments);
    }

    function _loadConfig() internal view returns (DeployConfig memory config) {
        config.privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        config.initialOwner = vm.envOr("INITIAL_OWNER", address(0));
        config.backendSigner = vm.envOr("BACKEND_SIGNER", address(0));
        config.usdc = vm.envAddress("USDC_ADDRESS");
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

    function _deployVault(address initialOwner, address usdc)
        internal
        returns (GameVault vault, address implementation, address proxy)
    {
        GameVault vaultImplementation = new GameVault();
        GameVault vaultProxy = GameVault(
            address(
                new ERC1967Proxy(
                    address(vaultImplementation), abi.encodeCall(GameVault.initialize, (initialOwner, usdc))
                )
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
                    abi.encodeCall(GameSettlement.initialize, (initialOwner, vault, backendSigner, sessionExpiryDelay))
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
        console2.log("USDC:", config.usdc);
        console2.log("Session expiry delay:", config.sessionExpiryDelay);
        console2.log("GameVault implementation:", deployments.vaultImplementation);
        console2.log("GameSettlement implementation:", deployments.settlementImplementation);
        console2.log("TrustPassport implementation:", deployments.passportImplementation);
        console2.log("GameVault proxy:", deployments.vaultProxy);
        console2.log("GameSettlement proxy:", deployments.settlementProxy);
        console2.log("TrustPassport proxy:", deployments.passportProxy);
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=%s", config.usdc);
        console2.log("NEXT_PUBLIC_USDC_FAUCET_ADDRESS=");
        console2.log("NEXT_PUBLIC_GAME_VAULT_ADDRESS=%s", deployments.vaultProxy);
        console2.log("NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=%s", deployments.settlementProxy);
        console2.log("NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=%s", deployments.passportProxy);
    }
}
