// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract Vault {
    using SafeTransferLib for address;

    address public immutable factory;
    bytes32 public immutable salt;

    constructor(bytes32 _salt) payable {
        factory = msg.sender;
        salt = _salt;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, NotFactory());
        _;
    }

    error InvalidData();
    error NotFactory();

    function transfer(address to, address[] calldata tokens, uint256[] calldata amounts) external onlyFactory {
        uint256 len = tokens.length;
        require(len == amounts.length, InvalidData());

        for (uint256 i; i < len; ++i) {
            tokens[i].safeTransfer(to, amounts[i]);
        }
    }

    function transferNative(address to) external onlyFactory {
        to.safeTransferETH(address(this).balance);
    }
}
