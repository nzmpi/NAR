import { z } from "zod";
import { TX_HASH } from "../accounting/pools.js";

// Money crosses the API as integer strings: USD in micro-USD, tokens in base units.
export const big = z
    .string()
    .regex(/^[0-9]{1,40}$/)
    .transform((s) => BigInt(s));
export const uuid = z.uuid();
export const poolKey = z.enum([
    "liquid",
    "lock_1m",
    "lock_2m",
    "lock_3m",
    "manager",
]);
export const lockKey = z.enum(["lock_1m", "lock_2m", "lock_3m"]);
export const txHash = z.string().regex(TX_HASH);
export const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const idParam = z.object({ id: uuid });
