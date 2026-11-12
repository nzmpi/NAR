import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors.js";

export interface TelegramUser {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
}

const bad = () =>
    new AppError("Invalid Telegram init data", 401, "bad_init_data");

// Mini App initData, bot-token HMAC method. Never trust initDataUnsafe.
export function validateInitData(
    raw: string,
    botToken: string,
    maxAgeSeconds: number,
    nowMs = Date.now(),
): { user: TelegramUser; authDate: number } {
    const params = new URLSearchParams(raw);
    const hash = params.get("hash");
    if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) throw bad();
    params.delete("hash");

    const dataCheckString = [...params.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const expected = createHmac("sha256", secret)
        .update(dataCheckString)
        .digest();
    const given = Buffer.from(hash, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
        throw bad();

    const authDate = Number(params.get("auth_date"));
    const nowSec = Math.floor(nowMs / 1000);
    if (
        !Number.isFinite(authDate) ||
        nowSec - authDate > maxAgeSeconds ||
        authDate - nowSec > 300
    )
        throw new AppError("Init data expired", 401, "init_data_expired");

    let user: TelegramUser;
    try {
        user = JSON.parse(params.get("user") ?? "");
    } catch {
        throw bad();
    }
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw bad();
    return { user, authDate };
}
