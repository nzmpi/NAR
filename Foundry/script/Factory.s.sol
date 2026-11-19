// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {Factory} from "../src/Factory.sol";
import {ProxyBase} from "../src/ProxyBase.sol";
import {Script, console} from "forge-std/Script.sol";

contract FactoryScript is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast();
        address admin = 0xdEAD000000000000000042069420694206942069;
        bytes32 factorySalt = keccak256("factory salt to deploy");
        Factory impl = new Factory{salt: factorySalt}();
        console.log(address(impl));
        bytes memory initData = abi.encodeCall(Factory.initialize, (admin));
        bytes32 proxySalt = keccak256("proxy salt to deploy");
        new ProxyBase{salt: proxySalt}(address(impl), admin, initData);
        vm.stopBroadcast();
    }
}
