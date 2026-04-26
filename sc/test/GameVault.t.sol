// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {GameVault} from "../src/GameVault.sol";
import {GameVaultV2} from "./mocks/UUPSMocks.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Rescue Token", "MRT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GameVaultTest is Test {
    GameUSDC internal token;
    GameVault internal vault;
    MockERC20 internal strayToken;

    address internal minter = address(0xC17E2);
    address internal settlement = address(0x5E771E);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new GameUSDC();
        ERC1967Proxy tokenProxy = new ERC1967Proxy(address(token), abi.encodeCall(GameUSDC.initialize, (address(this))));
        token = GameUSDC(address(tokenProxy));

        GameVault implementation = new GameVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(GameVault.initialize, (address(this), address(token)))
        );
        vault = GameVault(address(vaultProxy));
        vault.setSettlement(settlement);
        strayToken = new MockERC20();

        token.setMinter(minter, true);

        vm.prank(minter);
        token.mint(alice, 500 * 1e6);

        vm.prank(minter);
        token.mint(bob, 200 * 1e6);
    }

    function test_DepositAddsAvailableBalanceAndVaultBalance() public {
        vm.startPrank(alice);
        token.approve(address(vault), 150 * 1e6);
        vault.deposit(150 * 1e6);
        vm.stopPrank();

        assertEq(vault.availableBalanceOf(alice), 150 * 1e6);
        assertEq(vault.lockedBalanceOf(alice), 0);
        assertEq(vault.totalAvailableBalance(), 150 * 1e6);
        assertEq(vault.totalLockedBalance(), 0);
        assertEq(token.balanceOf(address(vault)), 150 * 1e6);
        assertEq(token.balanceOf(alice), 350 * 1e6);
    }

    function test_WithdrawUsesOnlyAvailableBalance() public {
        vm.startPrank(alice);
        token.approve(address(vault), 200 * 1e6);
        vault.deposit(200 * 1e6);
        vault.withdraw(50 * 1e6);
        vault.withdraw(150 * 1e6);
        vm.stopPrank();

        assertEq(vault.availableBalanceOf(alice), 0);
        assertEq(vault.lockedBalanceOf(alice), 0);
        assertEq(vault.totalAvailableBalance(), 0);
        assertEq(vault.totalLockedBalance(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(alice), 500 * 1e6);
    }

    function test_WithdrawMoreThanAvailableBalanceReverts() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100 * 1e6);
        vault.deposit(100 * 1e6);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientAvailableBalance.selector, 100 * 1e6, 101 * 1e6));
        vault.withdraw(101 * 1e6);
        vm.stopPrank();
    }

    function test_DepositZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_WithdrawZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(GameVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_PauseBlocksDepositsButStillAllowsWithdrawOfAvailableBalance() public {
        vm.startPrank(alice);
        token.approve(address(vault), 150 * 1e6);
        vault.deposit(150 * 1e6);
        vm.stopPrank();

        vault.pause();

        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(1);
        vault.withdraw(50 * 1e6);
        vm.stopPrank();

        assertEq(vault.availableBalanceOf(alice), 100 * 1e6);
        assertEq(token.balanceOf(alice), 400 * 1e6);
    }

    function test_FundTreasuryAddsTreasuryBalance() public {
        vm.startPrank(alice);
        token.approve(address(vault), 75 * 1e6);
        vault.fundTreasury(75 * 1e6);
        vm.stopPrank();

        assertEq(vault.treasuryBalance(), 75 * 1e6);
        assertEq(token.balanceOf(address(vault)), 75 * 1e6);
    }

    function test_OwnerCanWithdrawTreasuryOnly() public {
        vm.startPrank(alice);
        token.approve(address(vault), 75 * 1e6);
        vault.fundTreasury(75 * 1e6);
        vm.stopPrank();

        vault.treasuryWithdraw(bob, 25 * 1e6);

        assertEq(vault.treasuryBalance(), 50 * 1e6);
        assertEq(token.balanceOf(bob), 225 * 1e6);
        assertEq(token.balanceOf(address(vault)), 50 * 1e6);
    }

    function test_TreasuryWithdrawCannotUseUserDeposits() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100 * 1e6);
        vault.deposit(100 * 1e6);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientTreasury.selector, 0, 1));
        vault.treasuryWithdraw(bob, 1);
    }

    function test_OwnerCanRescueNonUsdcToken() public {
        strayToken.mint(address(vault), 50 ether);

        vault.rescueToken(address(strayToken), bob, 20 ether);

        assertEq(strayToken.balanceOf(bob), 20 ether);
        assertEq(strayToken.balanceOf(address(vault)), 30 ether);
    }

    function test_OwnerCanOnlyRescueExcessUsdc() public {
        vm.startPrank(alice);
        token.approve(address(vault), 90 * 1e6);
        vault.deposit(90 * 1e6);
        vm.stopPrank();

        vm.prank(minter);
        token.mint(address(vault), 15 * 1e6);

        vault.rescueToken(address(token), bob, 10 * 1e6);

        assertEq(token.balanceOf(bob), 210 * 1e6);
        assertEq(token.balanceOf(address(vault)), 95 * 1e6);
        assertEq(vault.totalAvailableBalance(), 90 * 1e6);
    }

    function test_CannotRescueReservedUsdcBalance() public {
        vm.startPrank(alice);
        token.approve(address(vault), 100 * 1e6);
        vault.deposit(100 * 1e6);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientRescuableBalance.selector, 0, 1));
        vault.rescueToken(address(token), bob, 1);
    }

    function test_PauseBlocksTreasuryFundingAndSettlementOps() public {
        bytes32 sessionId = keccak256("paused-session");

        vm.startPrank(alice);
        token.approve(address(vault), 200 * 1e6);
        vault.deposit(200 * 1e6);
        vm.stopPrank();

        vault.pause();

        vm.prank(alice);
        token.approve(address(vault), 10 * 1e6);

        vm.prank(alice);
        vm.expectRevert();
        vault.fundTreasury(10 * 1e6);

        vm.prank(settlement);
        vm.expectRevert();
        vault.lockStake(alice, sessionId, 20 * 1e6);
    }

    function test_LockedStakeCannotBeWithdrawn() public {
        bytes32 sessionId = keccak256("session-1");

        vm.startPrank(alice);
        token.approve(address(vault), 200 * 1e6);
        vault.deposit(200 * 1e6);
        vm.stopPrank();

        vm.prank(settlement);
        vault.lockStake(alice, sessionId, 120 * 1e6);

        assertEq(vault.availableBalanceOf(alice), 80 * 1e6);
        assertEq(vault.lockedBalanceOf(alice), 120 * 1e6);
        assertEq(vault.totalAvailableBalance(), 80 * 1e6);
        assertEq(vault.totalLockedBalance(), 120 * 1e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientAvailableBalance.selector, 80 * 1e6, 81 * 1e6));
        vault.withdraw(81 * 1e6);
    }

    function test_UserBalancesAreIndependent() public {
        vm.startPrank(alice);
        token.approve(address(vault), 120 * 1e6);
        vault.deposit(120 * 1e6);
        vm.stopPrank();

        vm.startPrank(bob);
        token.approve(address(vault), 80 * 1e6);
        vault.deposit(80 * 1e6);
        vm.stopPrank();

        assertEq(vault.availableBalanceOf(alice), 120 * 1e6);
        assertEq(vault.availableBalanceOf(bob), 80 * 1e6);
        assertEq(vault.lockedBalanceOf(alice), 0);
        assertEq(vault.lockedBalanceOf(bob), 0);
        assertEq(token.balanceOf(address(vault)), 200 * 1e6);
    }

    function test_OwnerCanUpgradeProxy() public {
        GameVaultV2 nextImplementation = new GameVaultV2();

        vault.upgradeToAndCall(address(nextImplementation), "");

        assertEq(GameVaultV2(address(vault)).version(), 2);
    }

    function test_NonOwnerCannotUpgradeProxy() public {
        GameVaultV2 nextImplementation = new GameVaultV2();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        vault.upgradeToAndCall(address(nextImplementation), "");
    }
}
