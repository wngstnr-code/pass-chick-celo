// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";
import {USDCFaucetV2} from "./mocks/UUPSMocks.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract USDCFaucetTest is Test {
    uint256 internal constant CLAIM_AMOUNT = 100 * 1e6;

    GameUSDC internal token;
    USDCFaucet internal faucet;
    USDCFaucet internal implementation;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new GameUSDC();

        ERC1967Proxy tokenProxy = new ERC1967Proxy(address(token), abi.encodeCall(GameUSDC.initialize, (address(this))));
        token = GameUSDC(address(tokenProxy));

        implementation = new USDCFaucet();
        ERC1967Proxy faucetProxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(USDCFaucet.initialize, (address(this), address(token), CLAIM_AMOUNT))
        );
        faucet = USDCFaucet(address(faucetProxy));

        token.setMinter(address(faucet), true);
    }

    function test_ClaimMintsExactAmount() public {
        vm.prank(alice);
        faucet.claim();

        assertEq(token.balanceOf(alice), CLAIM_AMOUNT);
    }

    function test_MultipleClaimsAreAllowedWithoutCooldown() public {
        vm.startPrank(alice);
        faucet.claim();
        faucet.claim();
        vm.stopPrank();

        assertEq(token.balanceOf(alice), CLAIM_AMOUNT * 2);
    }

    function test_DifferentUsersCanClaimIndependently() public {
        vm.prank(alice);
        faucet.claim();

        vm.prank(bob);
        faucet.claim();

        assertEq(token.balanceOf(alice), CLAIM_AMOUNT);
        assertEq(token.balanceOf(bob), CLAIM_AMOUNT);
    }

    function test_NonOwnerCannotUpdateClaimAmount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        faucet.setClaimAmount(50 * 1e6);
    }

    function test_OwnerCanUpdateClaimAmount() public {
        faucet.setClaimAmount(250 * 1e6);

        assertEq(faucet.claimAmount(), 250 * 1e6);
    }

    function test_ClaimRevertsWhenPaused() public {
        faucet.pause();

        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        faucet.claim();
    }

    function test_OwnerCanUpgradeProxy() public {
        USDCFaucetV2 nextImplementation = new USDCFaucetV2();

        faucet.upgradeToAndCall(address(nextImplementation), "");

        assertEq(USDCFaucetV2(address(faucet)).version(), 2);
        assertEq(faucet.claimAmount(), CLAIM_AMOUNT);
    }
}
