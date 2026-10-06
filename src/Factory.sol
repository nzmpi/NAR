// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Vault} from "./Vault.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title Factory
 * @author https://github.com/nzmpi
 * @notice A simple factory contract to deploy the Vault contract
 * @dev New versions must add new storage variables at the end of the current order!
 */
contract Factory layout at erc7201("nar.storage.factory") is IFactory, Initializable {
    string internal constant _VERSION = "1.0.0";

    address internal _owner;
    address internal _pendingOwner;
    mapping(bytes32 salt => address) internal _vaults;
    mapping(address vault => bytes32) internal _salts;

    modifier onlyOwner() {
        require(msg.sender == _owner, NotOwner());
        _;
    }

    /// @notice Disables the initializers.
    constructor() payable {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param owner The initial owner.
     */
    function initialize(address owner) external payable initializer {
        if (owner == address(0)) revert ZeroAddress();
        _owner = owner;
        emit OwnershipTransferred(address(0), owner);
    }

    /// @inheritdoc IFactory
    function deploy(bytes32 salt) external onlyOwner returns (address vault) {
        vault = address(_deploy(salt));
    }

    /// @inheritdoc IFactory
    function deployAndTransfer(bytes32 salt, address to, address[] calldata tokens, uint256[] calldata amounts)
        external
        onlyOwner
        returns (address)
    {
        Vault vault = _deploy(salt);
        vault.transfer(to, tokens, amounts);
        return address(vault);
    }

    /// @inheritdoc IFactory
    function transfer(address vault, address to, address[] calldata tokens, uint256[] calldata amounts)
        external
        onlyOwner
    {
        if (_salts[vault] == bytes32(0)) revert VaultDoesNotExist();
        Vault(vault).transfer(to, tokens, amounts);
    }

    /// @inheritdoc IFactory
    function transferNative(address vault, address to) external onlyOwner {
        if (_salts[vault] == bytes32(0)) revert VaultDoesNotExist();
        Vault(vault).transferNative(to);
    }

    /// @inheritdoc IFactory
    function transferOwnership(address newOwner) external onlyOwner {
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(msg.sender, newOwner);
    }

    /// @inheritdoc IFactory
    function acceptOwnership() external {
        address newOwner = _pendingOwner;
        require(msg.sender == newOwner, NotPendingOwner(newOwner));

        delete _pendingOwner;
        address previousOwner = _owner;
        _owner = msg.sender;
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    /// @inheritdoc IFactory
    function getOwner() external view returns (address) {
        return _owner;
    }

    /// @inheritdoc IFactory
    function getPendingOwner() external view returns (address) {
        return _pendingOwner;
    }

    /// @inheritdoc IFactory
    function getVault(bytes32 salt) external view returns (address) {
        return _vaults[salt];
    }

    /// @inheritdoc IFactory
    function getSalt(address vault) external view returns (bytes32) {
        return _salts[vault];
    }

    /// @inheritdoc IFactory
    function getVersion() external pure returns (string memory) {
        return _VERSION;
    }

    /**
     * @notice Deploys the Vault contract
     * @param _salt The salt of the vault
     * @return vault - The address of the deployed vault
     */
    function _deploy(bytes32 _salt) internal returns (Vault) {
        require(_vaults[_salt] == address(0), VaultExists());
        address vault = address(new Vault{salt: _salt}(_salt));
        _vaults[_salt] = vault;
        _salts[vault] = _salt;

        emit VaultCreated(vault, _salt);
        return Vault(vault);
    }
}
