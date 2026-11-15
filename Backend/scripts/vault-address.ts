// Cross-check the derivation against Solidity: compare with `cast create2` / a forge test.
//   npx tsx scripts/vault-address.ts <userId> <nonce> <factoryAddress> <path/to/Vault.json>
import { keccak256, concat } from "viem";
import {
    computeVaultAddress,
    readCreationBytecode,
    vaultSalt,
} from "../src/chain/vaultDerive.js";

const [userId, nonce, factory, artifact] = process.argv.slice(2);
if (!userId || nonce === undefined || !factory || !artifact) {
    console.error(
        "usage: vault-address.ts <userId> <nonce> <factory> <artifactJson>",
    );
    process.exit(1);
}
const creationBytecode = readCreationBytecode(artifact);
const salt = vaultSalt(userId, Number(nonce));
console.log("creation code hash:", keccak256(creationBytecode));
console.log("salt              :", salt);
console.log("init code hash    :", keccak256(concat([creationBytecode, salt])));
console.log(
    "vault address     :",
    computeVaultAddress({
        factory: factory as `0x${string}`,
        salt,
        creationBytecode,
    }),
);
