import type { Address, Hex } from "viem";
import { keccak256 } from "viem";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import {
    computeVaultAddress as derive,
    readCreationBytecode,
    vaultSalt,
} from "./vaultDerive.js";

export { vaultSalt };

export function getFactoryAddress(): Address {
    if (!config.FACTORY_ADDRESS)
        throw new AppError(
            "FACTORY_ADDRESS is not configured",
            503,
            "vault_config",
        );
    return config.FACTORY_ADDRESS as Address;
}

let creation: Hex | undefined;
export function getCreationBytecode(): Hex {
    if (!creation) {
        if (!config.VAULT_ARTIFACT_PATH)
            throw new AppError(
                "VAULT_ARTIFACT_PATH is not configured",
                503,
                "vault_config",
            );
        const code = readCreationBytecode(config.VAULT_ARTIFACT_PATH);
        // Addresses depend on these exact bytes. Pin the hash so a rebuild
        // (compiler, settings, source change) can never silently move vaults.
        if (
            config.VAULT_CREATION_CODE_HASH &&
            keccak256(code).toLowerCase() !==
                config.VAULT_CREATION_CODE_HASH.toLowerCase()
        )
            throw new Error(
                "Vault creation code hash mismatch; refusing to derive vault addresses",
            );
        creation = code;
    }
    return creation;
}

// Lowercase address of the vault for a salt, from the configured Factory and Vault bytecode.
export function computeVaultAddress(salt: Hex): string {
    return derive({
        factory: getFactoryAddress(),
        salt,
        creationBytecode: getCreationBytecode(),
    });
}

export function vaultAddressFor(userId: string, nonce: number) {
    const salt = vaultSalt(userId, nonce);
    return { salt, address: computeVaultAddress(salt) };
}
