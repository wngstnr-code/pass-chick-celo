// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GameSettlement} from "../src/GameSettlement.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

contract UpdateBackendSigner is Script {
    function run() external {
        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address settlementAddress = vm.envAddress("GAME_SETTLEMENT_ADDRESS");
        address passportAddress = vm.envOr("TRUST_PASSPORT_ADDRESS", address(0));
        address newBackendSigner = vm.envAddress("NEW_BACKEND_SIGNER");

        if (privateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(privateKey);
        }

        GameSettlement settlement = GameSettlement(settlementAddress);
        address previousSigner = settlement.backendSigner();
        settlement.setBackendSigner(newBackendSigner);

        address previousPassportSigner = address(0);
        if (passportAddress != address(0)) {
            TrustPassport passport = TrustPassport(passportAddress);
            previousPassportSigner = passport.backendSigner();
            passport.setBackendSigner(newBackendSigner);
            console2.log("TrustPassport:", passportAddress);
            console2.log("Previous passport signer:", previousPassportSigner);
            console2.log("New passport signer:", newBackendSigner);
        }

        vm.stopBroadcast();

        console2.log("Settlement:", settlementAddress);
        console2.log("Previous backend signer:", previousSigner);
        console2.log("New backend signer:", newBackendSigner);
    }
}
