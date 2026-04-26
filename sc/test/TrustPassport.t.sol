// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {TrustPassport} from "../src/TrustPassport.sol";
import {TrustPassportV2} from "./mocks/UUPSMocks.sol";

contract TrustPassportTest is Test {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    TrustPassport internal passport;

    uint256 internal backendSignerPk = 0xBADC0DE;
    address internal backendSigner;
    address internal player = address(0xA11CE);
    address internal otherPlayer = address(0xB0B);

    function setUp() public {
        backendSigner = vm.addr(backendSignerPk);

        TrustPassport implementation = new TrustPassport();
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(implementation), abi.encodeCall(TrustPassport.initialize, (address(this), backendSigner)));
        passport = TrustPassport(address(proxy));
    }

    function test_ClaimWithValidSignatureStoresPassport() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 2,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 123
        });

        bytes memory signature = _signClaim(claim, backendSignerPk);
        vm.prank(player);
        passport.claimWithSignature(claim, signature);

        TrustPassport.Passport memory stored = passport.getPassport(player);
        assertEq(stored.tier, 2);
        assertEq(stored.issuedAt, claim.issuedAt);
        assertEq(stored.expiry, claim.expiry);
        assertTrue(passport.usedNonces(claim.nonce));
        assertTrue(passport.isPassportValid(player));
    }

    function test_ClaimWithWrongSignerReverts() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 1,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 7 days),
            nonce: 1
        });

        bytes memory signature = _signClaim(claim, 0x111111);
        vm.prank(player);
        vm.expectRevert();
        passport.claimWithSignature(claim, signature);
    }

    function test_ClaimCannotReuseNonce() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 1,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 7 days),
            nonce: 77
        });
        bytes memory signature = _signClaim(claim, backendSignerPk);

        vm.prank(player);
        passport.claimWithSignature(claim, signature);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.NonceAlreadyUsed.selector, claim.nonce));
        passport.claimWithSignature(claim, signature);
    }

    function test_ClaimExpiredReverts() public {
        vm.warp(10 days);
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 1,
            issuedAt: uint64(block.timestamp - 8 days),
            expiry: uint64(block.timestamp - 1),
            nonce: 88
        });
        bytes memory signature = _signClaim(claim, backendSignerPk);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.PassportClaimExpired.selector, claim.expiry));
        passport.claimWithSignature(claim, signature);
    }

    function test_RevokePassportMarksPassportInvalid() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 3,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 55
        });

        bytes memory signature = _signClaim(claim, backendSignerPk);
        vm.prank(player);
        passport.claimWithSignature(claim, signature);

        passport.revokePassport(player);
        assertFalse(passport.isPassportValid(player));
    }

    function test_PlayerCannotClaimForOtherAddress() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 1,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 9
        });
        bytes memory signature = _signClaim(claim, backendSignerPk);

        vm.prank(otherPlayer);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.InvalidPlayer.selector, claim.player));
        passport.claimWithSignature(claim, signature);
    }

    function test_OwnerCanUpgradeProxy() public {
        TrustPassportV2 nextImplementation = new TrustPassportV2();
        passport.upgradeToAndCall(address(nextImplementation), "");

        assertEq(TrustPassportV2(address(passport)).version(), 2);
        assertEq(passport.owner(), address(this));
    }

    function test_NonOwnerCannotUpgradeProxy() public {
        TrustPassportV2 nextImplementation = new TrustPassportV2();
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player));
        passport.upgradeToAndCall(address(nextImplementation), "");
    }

    function _signClaim(TrustPassport.PassportClaim memory claim, uint256 signerPk) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("ChickenTrustPassport"),
                keccak256("1"),
                block.chainid,
                address(passport)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                passport.PASSPORT_CLAIM_TYPEHASH(),
                claim.player,
                claim.tier,
                claim.issuedAt,
                claim.expiry,
                claim.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
