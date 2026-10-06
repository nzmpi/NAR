// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Factory} from "../src/Factory.sol";
import {ProxyBase} from "../src/ProxyBase.sol";
import {Script} from "forge-std/Script.sol";

contract FactoryScript is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast();
        address proxyAdmin = address(0);
        address factoryAdmin = address(0);
        bytes32 salt = keccak256("salt");
        Factory impl = new Factory();
        bytes memory initData = abi.encodeCall(Factory.initialize, (factoryAdmin));
        new ProxyBase{salt: salt}(address(impl), proxyAdmin, initData);
        vm.stopBroadcast();
    }
}
