// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/**
 * @title IFactory
 * @author https://github.com/nzmpi
 * @notice An interface for the Factory contract
 */
interface IFactory {
    /**
     * @notice Emitted when the ownership transfer is started
     * @param previousOwner - The address of the previous owner
     * @param newOwner - The address of the new owner
     */
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    /**
     * @notice Emitted when the ownership is transferred
     * @param previousOwner - The address of the previous owner
     * @param newOwner - The address of the new owner
     */
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /**
     * @notice Emitted when a vault is created
     * @param vault - The address of the vault
     * @param salt - The salt of the vault
     */
    event VaultCreated(address indexed vault, bytes32 indexed salt);

    error ZeroAddress();
    error NotOwner();
    error NotPendingOwner(address pendingOwner);
    error VaultExists();
    error VaultDoesNotExists();

    /**
     * @notice Deploys a new vault
     * @param salt - The salt of the vault
     * @return vault - The address of the deployed vault
     * @notice The caller must be the owner
     */
    function deploy(bytes32 salt) external returns (address vault);
    /**
     * @notice Deploys a new vault and transfers tokens to the specified address
     * @param salt - The salt of the vault
     * @param to - The address to transfer the tokens to
     * @param tokens - The tokens to transfer
     * @param amounts - The amounts to transfer
     * @return vault - The address of the deployed vault
     * @notice The caller must be the owner
     */
    function deployAndTransfer(bytes32 salt, address to, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (address vault);
    /**
     * @notice Transfers native tokens to the specified address
     * @param vault - The address of the vault
     * @param to - The address to transfer the tokens to
     * @notice The caller must be the owner
     */
    function transferNative(address vault, address to) external;
    /**
     * @notice 2-step transfer of ownership to a new owner
     * @param newOwner - The new owner address
     * @notice The caller must be the owner
     */
    function transferOwnership(address newOwner) external;
    /**
     * @notice Accepts ownership
     * @notice Only the pending owner can call this function
     */
    function acceptOwnership() external;

    /**
     * @notice Returns the owner address
     * @return owner - The address of the owner
     */
    function getOwner() external view returns (address);
    /**
     * @notice Returns the pending owner address
     * @return pendingOwner - The address of the pending owner
     */
    function getPendingOwner() external view returns (address);
    /**
     * @notice Returns the vault address
     * @param salt - The salt of the vault
     * @return vault - The address of the vault
     */
    function getVault(bytes32 salt) external view returns (address);
    /**
     * @notice Returns the salt of the vault
     * @param vault - The address of the vault
     * @return salt - The salt of the vault
     */
    function getSalt(address vault) external view returns (bytes32);
    /**
     * @notice Returns the version of the contract
     * @return version - The version of the contract
     */
    function version() external pure returns (string memory);
}
