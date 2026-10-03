// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Vault} from "./Vault.sol";

contract Factory {
    mapping(bytes32 => address) public vaults;

    function deploy(bytes32 salt) external {
        new Vault{salt: salt}(salt);
    }

    function deployAndTransfer(bytes32 salt, address to, address[] calldata tokens, uint256[] calldata amounts)
        external
    {
        Vault vault = new Vault{salt: salt}(salt);
        vault.transfer(to, tokens, amounts);
    }
}
