// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Vault} from "../src/Vault.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {Test, console2} from "forge-std/Test.sol";

contract VaultTest is Test {
    bytes32 salt;
    Vault vault;
    address user1 = vm.addr(1);
    address user2 = vm.addr(2);
    MockERC20 token;

    function setUp() public {
        salt = keccak256("salt");
        vm.prank(user1);
        vault = new Vault{salt: salt}(salt);

        token = new MockERC20();
        token.mint(address(this), 100 ether);
    }

    function test_setUp() public view {
        bytes32 initHash = keccak256(bytes.concat(type(Vault).creationCode, abi.encode(salt)));
        address computedAddress = vm.computeCreate2Address(salt, initHash, user1);

        assertEq(computedAddress, address(vault), "Wrong computed vault address");
        assertEq(vault.FACTORY(), user1, "Wrong factory address");
        assertEq(vault.SALT(), salt, "Wrong salt");
    }

    function test_transfer() public {
        token.transfer(address(vault), 10 ether);
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = address(token);
        amounts[0] = 2 ether;

        vm.expectRevert(Vault.NotFactory.selector);
        vault.transfer(user2, tokens, amounts);

        vm.startPrank(user1);
        uint256 vaultBalanceBefore = token.balanceOf(address(vault));
        uint256 user2BalanceBefore = token.balanceOf(user2);
        vault.transfer(user2, tokens, amounts);
        assertEq(token.balanceOf(address(vault)), vaultBalanceBefore - amounts[0], "Wrong vault balance");
        assertEq(token.balanceOf(user2), user2BalanceBefore + amounts[0], "Wrong user2 balance");

        amounts = new uint256[](2);
        amounts[0] = 2 ether;
        amounts[1] = 2 ether;
        vm.expectRevert(Vault.InvalidData.selector);
        vault.transfer(user2, tokens, amounts);
        vm.stopPrank();
    }

    function test_transferNative() public {
        vm.deal(address(vault), 10 ether);

        vm.expectRevert(Vault.NotFactory.selector);
        vault.transferNative(user2);

        vm.startPrank(user1);
        uint256 user2BalanceBefore = user2.balance;
        vm.expectEmit(true, true, true, true);
        emit Vault.NativeTransfered(user2, 10 ether);
        vault.transferNative(user2);
        assertEq(address(vault).balance, 0, "Wrong vault balance");
        assertEq(user2.balance, user2BalanceBefore + 10 ether, "Wrong user2 balance");
        vm.stopPrank();
    }
}
