import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { AppError } from "../errors.js";

const ISSUER = "https://oauth.telegram.org";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export function pkcePair() {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export function buildAuthUrl(p: {
    state: string;
    nonce: string;
    challenge: string;
}) {
    const u = new URL(`${ISSUER}/auth`);
    u.search = new URLSearchParams({
        client_id: config.BOT_ID,
        redirect_uri: config.ADMIN_CALLBACK_URL,
        response_type: "code",
        scope: "openid profile", // profile adds the numeric `id` claim
        state: p.state,
        nonce: p.nonce,
        code_challenge: p.challenge,
        code_challenge_method: "S256",
    }).toString();
    return u.toString();
}

export async function exchangeCode(
    code: string,
    verifier: string,
): Promise<string> {
    const basic = Buffer.from(
        `${config.BOT_ID}:${config.TELEGRAM_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch(`${ISSUER}/token`, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.ADMIN_CALLBACK_URL,
            client_id: config.BOT_ID,
            code_verifier: verifier,
        }),
    });
    if (!res.ok)
        throw new AppError("Telegram login failed", 401, "login_failed");
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token)
        throw new AppError("Telegram login failed", 401, "login_failed");
    return json.id_token;
}

// Verifies signature, issuer, audience (bot id), expiry and nonce, and returns
// the Telegram user ID (the `id` claim). Nonce is checked when Telegram echoes it.
export async function verifyIdToken(
    idToken: string,
    expectedNonce: string,
): Promise<string> {
    let payload;
    try {
        ({ payload } = await jwtVerify(idToken, jwks, {
            issuer: ISSUER,
            audience: config.BOT_ID,
            algorithms: ["RS256", "ES256"],
        }));
    } catch {
        throw new AppError("Telegram login failed", 401, "login_failed");
    }
    if (payload.nonce !== expectedNonce)
        throw new AppError("Telegram login failed", 401, "login_failed");
    const id = (payload as Record<string, unknown>).id;
    if (typeof id !== "number" && typeof id !== "string")
        throw new AppError("Telegram login failed", 401, "login_failed");
    const s = String(id);
    if (!/^[0-9]+$/.test(s))
        throw new AppError("Telegram login failed", 401, "login_failed");
    return s;
}
