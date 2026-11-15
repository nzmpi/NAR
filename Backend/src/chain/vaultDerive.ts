import { readFileSync } from "node:fs";
import {
    concat,
    encodeAbiParameters,
    getCreate2Address,
    keccak256,
    type Address,
    type Hex,
} from "viem";

// Pure helpers (no app config), so scripts can reuse them.

// Reads the Vault creation bytecode from a Foundry (`bytecode.object`) or
// Hardhat (`bytecode`) artifact JSON.
export function readCreationBytecode(artifactPath: string): Hex {
    const json = JSON.parse(readFileSync(artifactPath, "utf8"));
    const raw =
        typeof json.bytecode === "string"
            ? json.bytecode
            : json.bytecode?.object;
    if (
        typeof raw !== "string" ||
        !/^0x[0-9a-fA-F]+$/.test(raw) ||
        raw.length % 2 !== 0
    )
        throw new Error("Vault artifact has no valid creation bytecode");
    if (raw.length < 100)
        throw new Error("Vault creation bytecode looks empty");
    return raw as Hex;
}

// salt = keccak256(abi.encode(uint256 userUuid, uint256 nonce)); userUuid = users.id as 128-bit int.
export function vaultSalt(userId: string, nonce: number): Hex {
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            userId,
        )
    ) {
        throw new Error("vaultSalt: userId must be a UUID");
    }
    const uid = BigInt("0x" + userId.replaceAll("-", ""));
    return keccak256(
        encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [uid, BigInt(nonce)],
        ),
    );
}

// CREATE2 from the Factory: `new Vault{salt}(salt)`; Vault's constructor takes
// bytes32 salt, so init code = creation bytecode ++ salt. The deployer is the
// Factory address users interact with (the proxy, if it is behind one).
export function computeVaultAddress(p: {
    factory: Address;
    salt: Hex;
    creationBytecode: Hex;
}): string {
    const initCode = concat([p.creationBytecode, p.salt]);
    return getCreate2Address({
        from: p.factory,
        salt: p.salt,
        bytecode: initCode,
    }).toLowerCase();
}
