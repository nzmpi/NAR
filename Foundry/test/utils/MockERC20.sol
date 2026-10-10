// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {ERC20} from "solady/tokens/ERC20.sol";

contract MockERC20 is ERC20 {
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function name() public pure override returns (string memory) {
        return "MockERC20";
    }

    function symbol() public pure override returns (string memory) {
        return "MOCK";
    }
}
