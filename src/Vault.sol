// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

/**
 * @title Vault
 * @author https://github.com/nzmpi
 * @notice A simple Vault contract
 */
contract Vault {
    using SafeTransferLib for address;

    /// @notice The address of the Factory contract
    address public immutable FACTORY;
    /// @notice The salt of the Vault
    bytes32 public immutable SALT;

    /**
     * @notice Emitted when a native token is transfered
     * @param to - The address the tokens are transfered to
     * @param amount - The amount of tokens transfered
     */
    event NativeTransfered(address indexed to, uint256 amount);

    error InvalidData();
    error NotFactory();

    modifier onlyFactory() {
        require(msg.sender == FACTORY, NotFactory());
        _;
    }

    /**
     * @notice Initializes the Vault contract
     * @param salt - The salt of the Vault
     */
    constructor(bytes32 salt) payable {
        FACTORY = msg.sender;
        SALT = salt;
    }

    /**
     * @notice Transfers tokens to the specified address
     * @notice Can only be called by the Factory
     * @param to - The address the tokens are transfered to
     * @param tokens - The addresses of the tokens
     * @param amounts - The amounts of the tokens
     */
    function transfer(address to, address[] calldata tokens, uint256[] calldata amounts) external onlyFactory {
        uint256 len = tokens.length;
        require(len == amounts.length, InvalidData());

        for (uint256 i; i < len; ++i) {
            tokens[i].safeTransfer(to, amounts[i]);
        }
    }

    /**
     * @notice Transfers all native tokens to the specified address
     * @notice Can only be called by the Factory
     * @param to - The address the tokens are transfered to
     */
    function transferNative(address to) external onlyFactory {
        emit NativeTransfered(to, address(this).balance);
        to.safeTransferETH(address(this).balance);
    }
}
