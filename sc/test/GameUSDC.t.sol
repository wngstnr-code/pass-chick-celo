// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {GameUSDCV2} from "./mocks/UUPSMocks.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract GameUSDCTest is Test {
    GameUSDC internal token;
    GameUSDC internal implementation;

    address internal owner = address(this);
    address internal faucet = address(0xFAC37);
    address internal alice = address(0xA11CE);

    function setUp() public {
        implementation = new GameUSDC();
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), abi.encodeCall(GameUSDC.initialize, (owner)));
        token = GameUSDC(address(proxy));
    }

    function test_InitialSupplyIsZero() public view {
        assertEq(token.totalSupply(), 0);
    }

    function test_DecimalsAreSix() public view {
        assertEq(token.decimals(), 6);
    }

    function test_OwnerCanSetMinter() public {
        token.setMinter(faucet, true);

        assertTrue(token.minters(faucet));
    }

    function test_OnlyOwnerCanSetMinter() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        token.setMinter(faucet, true);
    }

    function test_OnlyAuthorizedMinterCanMint() public {
        vm.expectRevert(abi.encodeWithSelector(GameUSDC.UnauthorizedMinter.selector, owner));
        token.mint(alice, 100 * 1e6);
    }

    function test_AuthorizedMinterCanMint() public {
        token.setMinter(faucet, true);

        vm.prank(faucet);
        token.mint(alice, 100 * 1e6);

        assertEq(token.balanceOf(alice), 100 * 1e6);
        assertEq(token.totalSupply(), 100 * 1e6);
    }

    function test_ImplementationCannotBeInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(owner);
    }

    function test_OwnerCanUpgradeProxy() public {
        GameUSDCV2 nextImplementation = new GameUSDCV2();

        token.upgradeToAndCall(address(nextImplementation), "");

        assertEq(GameUSDCV2(address(token)).version(), 2);
        assertEq(token.owner(), owner);
    }

    function test_NonOwnerCannotUpgradeProxy() public {
        GameUSDCV2 nextImplementation = new GameUSDCV2();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        token.upgradeToAndCall(address(nextImplementation), "");
    }
}
