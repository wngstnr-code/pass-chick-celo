// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {GameUSDC} from "../src/GameUSDC.sol";
import {USDCFaucet} from "../src/USDCFaucet.sol";
import {GameVault} from "../src/GameVault.sol";
import {GameSettlement} from "../src/GameSettlement.sol";
import {GameSettlementV2} from "./mocks/UUPSMocks.sol";

contract GameSettlementTest is Test {
    uint256 internal constant CLAIM_AMOUNT = 100 * 1e6;
    uint64 internal constant SESSION_EXPIRY_DELAY = 1 days;

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    GameUSDC internal token;
    USDCFaucet internal faucet;
    GameVault internal vault;
    GameSettlement internal settlement;

    uint256 internal backendSignerPk = 0xA11CE1234;
    address internal backendSigner;
    address internal player = address(0xBEEF1);
    address internal otherPlayer = address(0xBEEF2);

    function setUp() public {
        backendSigner = vm.addr(backendSignerPk);

        GameUSDC tokenImplementation = new GameUSDC();
        ERC1967Proxy tokenProxy =
            new ERC1967Proxy(address(tokenImplementation), abi.encodeCall(GameUSDC.initialize, (address(this))));
        token = GameUSDC(address(tokenProxy));

        USDCFaucet faucetImplementation = new USDCFaucet();
        ERC1967Proxy faucetProxy = new ERC1967Proxy(
            address(faucetImplementation),
            abi.encodeCall(USDCFaucet.initialize, (address(this), address(token), CLAIM_AMOUNT))
        );
        faucet = USDCFaucet(address(faucetProxy));

        GameVault vaultImplementation = new GameVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImplementation), abi.encodeCall(GameVault.initialize, (address(this), address(token)))
        );
        vault = GameVault(address(vaultProxy));

        GameSettlement settlementImplementation = new GameSettlement();
        ERC1967Proxy settlementProxy = new ERC1967Proxy(
            address(settlementImplementation),
            abi.encodeCall(
                GameSettlement.initialize, (address(this), address(vault), backendSigner, SESSION_EXPIRY_DELAY)
            )
        );
        settlement = GameSettlement(address(settlementProxy));

        vault.setSettlement(address(settlement));
        token.setMinter(address(faucet), true);
    }

    function test_StartSessionLocksStakeAndPreventsSecondActiveSession() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("session-1");

        vm.prank(player);
        settlement.startSession(sessionId, 40 * 1e6);

        assertEq(settlement.activeSessionOf(player), sessionId);
        assertEq(vault.availableBalanceOf(player), 60 * 1e6);
        assertEq(vault.lockedBalanceOf(player), 40 * 1e6);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(GameSettlement.SessionAlreadyActive.selector, player, sessionId));
        settlement.startSession(keccak256("session-2"), 20 * 1e6);
    }

    function test_PauseBlocksSessionStartAndSettlement() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);
        _fundTreasury(50 * 1e6);

        bytes32 sessionId = keccak256("paused-settlement");

        settlement.pause();

        vm.prank(player);
        vm.expectRevert();
        settlement.startSession(sessionId, 20 * 1e6);

        settlement.unpause();

        vm.prank(player);
        settlement.startSession(sessionId, 20 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 20 * 1e6,
            payoutAmount: 24 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);

        settlement.pause();
        vm.expectRevert();
        settlement.settleWithSignature(resolution, signature);
    }

    function test_SettleCashoutMovesPayoutToAvailableBalance() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);
        _fundTreasury(50 * 1e6);

        bytes32 sessionId = keccak256("cashout-session");

        vm.prank(player);
        settlement.startSession(sessionId, 50 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 50 * 1e6,
            payoutAmount: 60 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        settlement.settleWithSignature(resolution, signature);

        assertEq(vault.availableBalanceOf(player), 110 * 1e6);
        assertEq(vault.lockedBalanceOf(player), 0);
        assertEq(vault.treasuryBalance(), 40 * 1e6);
        assertEq(settlement.activeSessionOf(player), bytes32(0));
    }

    function test_SettleCrashMovesLockedStakeToTreasury() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("crash-session");

        vm.prank(player);
        settlement.startSession(sessionId, 35 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 35 * 1e6,
            payoutAmount: 0,
            finalMultiplierBp: 0,
            outcome: settlement.OUTCOME_CRASHED(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        settlement.settleWithSignature(resolution, signature);

        assertEq(vault.availableBalanceOf(player), 65 * 1e6);
        assertEq(vault.lockedBalanceOf(player), 0);
        assertEq(vault.treasuryBalance(), 35 * 1e6);
        assertEq(settlement.activeSessionOf(player), bytes32(0));
    }

    function test_SettleWithWrongSignerReverts() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("wrong-signer-session");

        vm.prank(player);
        settlement.startSession(sessionId, 20 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 20 * 1e6,
            payoutAmount: 24 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        uint256 wrongSignerPk = 0xDEADBEEF;
        bytes memory signature = _signResolution(resolution, wrongSignerPk);

        vm.expectRevert();
        settlement.settleWithSignature(resolution, signature);
    }

    function test_SettleWithExpiredDeadlineReverts() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("expired-session");

        vm.prank(player);
        settlement.startSession(sessionId, 20 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 20 * 1e6,
            payoutAmount: 24 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        vm.warp(block.timestamp + 2);

        vm.expectRevert(abi.encodeWithSelector(GameSettlement.ResolutionExpired.selector, resolution.deadline));
        settlement.settleWithSignature(resolution, signature);
    }

    function test_ExpireSessionRevertsBeforeTimeout() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("not-expired-session");

        vm.prank(player);
        settlement.startSession(sessionId, 20 * 1e6);

        vm.expectRevert(
            abi.encodeWithSelector(
                GameSettlement.SessionNotExpired.selector, uint64(block.timestamp + SESSION_EXPIRY_DELAY)
            )
        );
        settlement.expireSession(sessionId);
    }

    function test_ExpireSessionCrashesStuckSessionAfterTimeout() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("expired-session");

        vm.prank(player);
        settlement.startSession(sessionId, 30 * 1e6);

        vm.warp(block.timestamp + SESSION_EXPIRY_DELAY + 1);
        settlement.expireSession(sessionId);

        assertEq(vault.availableBalanceOf(player), 70 * 1e6);
        assertEq(vault.lockedBalanceOf(player), 0);
        assertEq(vault.treasuryBalance(), 30 * 1e6);
        assertEq(settlement.activeSessionOf(player), bytes32(0));
    }

    function test_SettledSessionCannotBeSettledTwice() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);
        _fundTreasury(10 * 1e6);

        bytes32 sessionId = keccak256("double-settle");

        vm.prank(player);
        settlement.startSession(sessionId, 20 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 20 * 1e6,
            payoutAmount: 24 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        settlement.settleWithSignature(resolution, signature);

        vm.expectRevert(abi.encodeWithSelector(GameSettlement.SessionAlreadySettled.selector, sessionId));
        settlement.settleWithSignature(resolution, signature);
    }

    function test_PayoutAboveStakeAndTreasuryReverts() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("insufficient-treasury");

        vm.prank(player);
        settlement.startSession(sessionId, 25 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 25 * 1e6,
            payoutAmount: 40 * 1e6,
            finalMultiplierBp: 16_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);

        vm.expectRevert(abi.encodeWithSelector(GameVault.InsufficientTreasury.selector, 0, 15 * 1e6));
        settlement.settleWithSignature(resolution, signature);
    }

    function test_ClaimDepositStartCashoutFlowWorks() public {
        _claimAndDeposit(player, CLAIM_AMOUNT);
        _fundTreasury(50 * 1e6);

        bytes32 sessionId = keccak256("integration-cashout");

        vm.prank(player);
        settlement.startSession(sessionId, 40 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: player,
            stakeAmount: 40 * 1e6,
            payoutAmount: 48 * 1e6,
            finalMultiplierBp: 12_000,
            outcome: settlement.OUTCOME_CASHED_OUT(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        settlement.settleWithSignature(resolution, signature);

        assertEq(vault.availableBalanceOf(player), 108 * 1e6);
        assertEq(vault.lockedBalanceOf(player), 0);
    }

    function test_ClaimDepositStartCrashFlowWorks() public {
        _claimAndDeposit(otherPlayer, CLAIM_AMOUNT);

        bytes32 sessionId = keccak256("integration-crash");

        vm.prank(otherPlayer);
        settlement.startSession(sessionId, 30 * 1e6);

        GameSettlement.Resolution memory resolution = GameSettlement.Resolution({
            sessionId: sessionId,
            player: otherPlayer,
            stakeAmount: 30 * 1e6,
            payoutAmount: 0,
            finalMultiplierBp: 0,
            outcome: settlement.OUTCOME_CRASHED(),
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes memory signature = _signResolution(resolution, backendSignerPk);
        settlement.settleWithSignature(resolution, signature);

        assertEq(vault.availableBalanceOf(otherPlayer), 70 * 1e6);
        assertEq(vault.lockedBalanceOf(otherPlayer), 0);
        assertEq(vault.treasuryBalance(), 30 * 1e6);
    }

    function test_OwnerCanUpgradeSettlementProxy() public {
        GameSettlementV2 nextImplementation = new GameSettlementV2();

        settlement.upgradeToAndCall(address(nextImplementation), "");

        assertEq(GameSettlementV2(address(settlement)).version(), 2);
    }

    function test_NonOwnerCannotUpgradeSettlementProxy() public {
        GameSettlementV2 nextImplementation = new GameSettlementV2();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player));
        settlement.upgradeToAndCall(address(nextImplementation), "");
    }

    function _claimAndDeposit(address user, uint256 amount) internal {
        vm.startPrank(user);
        faucet.claim();
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _fundTreasury(uint256 amount) internal {
        faucet.claim();
        token.approve(address(vault), amount);
        vault.fundTreasury(amount);
    }

    function _signResolution(GameSettlement.Resolution memory resolution, uint256 signerPrivateKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("ChickenCrossingSettlement")),
                keccak256(bytes("1")),
                block.chainid,
                address(settlement)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                settlement.RESOLUTION_TYPEHASH(),
                resolution.sessionId,
                resolution.player,
                resolution.stakeAmount,
                resolution.payoutAmount,
                resolution.finalMultiplierBp,
                resolution.outcome,
                resolution.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
