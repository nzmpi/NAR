// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Factory} from "../src/Factory.sol";
import {ProxyBase} from "../src/ProxyBase.sol";
import {Vault} from "../src/Vault.sol";
import {IFactory} from "../src/interfaces/IFactory.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {Test, console2} from "forge-std/Test.sol";

contract FactoryTest is Test {
    IFactory factory;
    bytes32 salt = keccak256("salt");
    bytes32 initHash = keccak256(bytes.concat(type(Vault).creationCode, abi.encode(salt)));
    address expectedAddress;
    address proxyAdmin = vm.addr(42);
    address user1 = vm.addr(1);
    address user2 = vm.addr(2);
    MockERC20 token;
    address[] tokens = new address[](1);
    uint256[] amounts = new uint256[](1);

    function setUp() public {
        Factory impl = new Factory();
        bytes memory initData = abi.encodeCall(Factory.initialize, (user1));
        ProxyBase proxy = new ProxyBase(address(impl), proxyAdmin, initData);
        factory = IFactory(address(proxy));
        expectedAddress = vm.computeCreate2Address(salt, initHash, address(factory));
        token = new MockERC20();
        token.mint(address(this), 100 ether);
        tokens[0] = address(token);
        amounts[0] = 2 ether;
    }

    function test_setUp() public view {
        assertEq(factory.getOwner(), user1, "Wrong factory owner");
        bytes32 slot = keccak256(abi.encode(uint256(keccak256("nar.storage.factory")) - 1)) & ~bytes32(uint256(0xff));
        bytes32 value = vm.load(address(factory), slot);
        assertEq(value, bytes32(abi.encode(user1)), "Wrong factory storage value");
        assertEq(vm.load(address(factory), bytes32(0)), bytes32(0), "Wrong factory storage value at 0");
        assertEq(factory.getPendingOwner(), address(0), "Wrong pending factory owner");
        assertEq(factory.getVersion(), "1.0.0", "Wrong factory version");
    }

    function test_deploy() public {
        vm.expectRevert(IFactory.NotOwner.selector);
        factory.deploy(salt);

        vm.startPrank(user1);
        assertEq(factory.getVault(salt), address(0), "Wrong initial vault address from salt");
        assertEq(factory.getSalt(expectedAddress), bytes32(0), "Wrong initial salt from vault");
        vm.expectEmit(true, true, true, true);
        emit IFactory.VaultCreated(expectedAddress, salt);
        address vault = factory.deploy(salt);
        assertEq(vault, expectedAddress, "Wrong vault address");
        assertEq(factory.getVault(salt), vault, "Wrong vault address from salt");
        assertEq(factory.getSalt(vault), salt, "Wrong salt from vault");

        vm.expectRevert(IFactory.VaultExists.selector);
        factory.deploy(salt);
        vm.stopPrank();
    }

    function test_deployAndTransfer() public {
        token.transfer(expectedAddress, 5 ether);
        uint256 vaultBalanceBefore = token.balanceOf(expectedAddress);
        uint256 user2BalanceBefore = token.balanceOf(user2);

        vm.expectRevert(IFactory.NotOwner.selector);
        factory.deployAndTransfer(salt, user2, tokens, amounts);

        vm.startPrank(user1);
        address vault = factory.deployAndTransfer(salt, user2, tokens, amounts);
        assertEq(vault, expectedAddress, "Wrong vault address");
        assertEq(token.balanceOf(vault), vaultBalanceBefore - amounts[0], "Wrong vault balance after");
        assertEq(token.balanceOf(user2), user2BalanceBefore + amounts[0], "Wrong user2 balance after");
        vm.stopPrank();
    }

    function test_transfer() public {
        token.transfer(expectedAddress, 5 ether);
        uint256 vaultBalanceBefore = token.balanceOf(expectedAddress);
        uint256 user2BalanceBefore = token.balanceOf(user2);

        vm.expectRevert(IFactory.NotOwner.selector);
        factory.transfer(expectedAddress, user2, tokens, amounts);

        vm.startPrank(user1);
        vm.expectRevert(IFactory.VaultDoesNotExist.selector);
        factory.transfer(expectedAddress, user2, tokens, amounts);

        address vault = factory.deploy(salt);
        factory.transfer(vault, user2, tokens, amounts);

        assertEq(token.balanceOf(vault), vaultBalanceBefore - amounts[0], "Wrong vault balance after");
        assertEq(token.balanceOf(user2), user2BalanceBefore + amounts[0], "Wrong user2 balance after");
        vm.stopPrank();
    }

    function test_transferNative() public {
        vm.deal(expectedAddress, 10 ether);

        vm.expectRevert(IFactory.NotOwner.selector);
        factory.transferNative(expectedAddress, user2);

        vm.startPrank(user1);
        vm.expectRevert(IFactory.VaultDoesNotExist.selector);
        factory.transferNative(expectedAddress, user2);

        address vault = factory.deploy(salt);
        factory.transferNative(vault, user2);

        assertEq(vault.balance, 0, "Wrong vault balance after");
        assertEq(user2.balance, 10 ether, "Wrong user2 balance after");
        vm.stopPrank();
    }

    function test_transferAndAcceptOwnership() public {
        vm.expectRevert(IFactory.NotOwner.selector);
        factory.transferOwnership(user2);

        vm.startPrank(user1);
        vm.expectEmit(true, true, true, true);
        emit IFactory.OwnershipTransferStarted(user1, user2);
        factory.transferOwnership(user2);

        assertEq(factory.getOwner(), user1, "Wrong factory owner after transfer");
        assertEq(factory.getPendingOwner(), user2, "Wrong pending factory owner after transfer");
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IFactory.NotPendingOwner.selector, user2));
        factory.acceptOwnership();

        vm.startPrank(user2);
        vm.expectEmit(true, true, true, true);
        emit IFactory.OwnershipTransferred(user1, user2);
        factory.acceptOwnership();
        assertEq(factory.getOwner(), user2, "Wrong factory owner after accept");
        assertEq(factory.getPendingOwner(), address(0), "Wrong pending factory owner after accept");
        vm.stopPrank();
    }
}
