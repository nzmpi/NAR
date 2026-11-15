import { createHmac } from "node:crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { validateInitData } from "../src/auth/initData.js";
import { computeVaultAddress, vaultSalt } from "../src/chain/vaultDerive.js";
import { userLimit } from "../src/http/limits.js";
import { ok, rejects } from "./lib/harness.js";

// Vault derivation: UUID + nonce only
const uid = "3f2b8c1e-9d4a-4e57-8b21-0a6c5d7e9f10";
const uidInt = BigInt("0x" + uid.replaceAll("-", ""));
ok(
    vaultSalt(uid, 0) ===
        keccak256(
            encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256" }],
                [uidInt, 0n],
            ),
        ),
    "salt = keccak(abi.encode(uuid, nonce))",
);
ok(vaultSalt(uid, 0) !== vaultSalt(uid, 1), "nonce changes the salt");
ok(
    vaultSalt(uid, 0) !== vaultSalt("3f2b8c1e-9d4a-4e57-8b21-0a6c5d7e9f11", 0),
    "user changes the salt",
);
ok(
    vaultSalt(uid.toUpperCase(), 0) === vaultSalt(uid, 0),
    "UUID case does not matter",
);
let threw = false;
try {
    vaultSalt("123456789", 0);
} catch {
    threw = true;
}
ok(threw, "numeric (Telegram-style) id rejected");

const factory = "0x1111111111111111111111111111111111111111";
const code = "0x6080604052" as Hex;
const a1 = computeVaultAddress({
    factory,
    salt: vaultSalt(uid, 0),
    creationBytecode: code,
});
ok(
    a1 ===
        computeVaultAddress({
            factory,
            salt: vaultSalt(uid, 0),
            creationBytecode: code,
        }),
    "address is deterministic",
);
ok(
    a1 !==
        computeVaultAddress({
            factory,
            salt: vaultSalt(uid, 1),
            creationBytecode: code,
        }),
    "nonce gives a different address",
);
ok(
    a1 !==
        computeVaultAddress({
            factory,
            salt: vaultSalt(uid, 0),
            creationBytecode: "0x6080604053",
        }),
    "bytecode change moves the address (pin the hash)",
);

// Telegram initData
const TOKEN = "123456:TEST";
function sign(fields: Record<string, string>) {
    const dcs = Object.entries(fields)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secret).update(dcs).digest("hex");
    return new URLSearchParams({ ...fields, hash }).toString();
}
const NOW = 1_800_000_000_000;
const fields = {
    auth_date: String(NOW / 1000 - 10),
    query_id: "AAA",
    user: JSON.stringify({ id: 42, username: "x" }),
};
ok(
    validateInitData(sign(fields), TOKEN, 3600, NOW).user.id === 42,
    "valid initData accepted",
);
const tampered = sign(fields).replace("%22x%22", "%22y%22");
for (const [label, raw, tok] of [
    ["tampered payload", tampered, TOKEN],
    ["wrong bot token", sign(fields), "999:OTHER"],
    ["missing hash", "auth_date=1", TOKEN],
] as const) {
    let bad = false;
    try {
        validateInitData(raw, tok, 3600, NOW);
    } catch {
        bad = true;
    }
    ok(bad, `initData rejected: ${label}`);
}
let expired = false;
try {
    validateInitData(
        sign({ ...fields, auth_date: String(NOW / 1000 - 7200) }),
        TOKEN,
        3600,
        NOW,
    );
} catch {
    expired = true;
}
ok(expired, "initData rejected: expired");

// Per-user limiter
const lim = userLimit("unit", 3);
const req: any = { user: { id: "u1" }, ip: "1.1.1.1" };
await lim(req);
await lim(req);
await lim(req);
await rejects(lim(req), "4th request in a window is limited");
await lim({ user: { id: "u2" }, ip: "1.1.1.1" } as any);
ok(true, "other users are not affected");

console.log("units ok");
process.exit(0);
