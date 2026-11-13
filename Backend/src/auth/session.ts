import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.js";

const key = new TextEncoder().encode(config.SESSION_SECRET);
const ISSUER = "nar-api";

export type TokenAudience = "oidc-flow" | "admin-session";

export function signToken(
    payload: JWTPayload,
    ttlSeconds: number,
    aud: TokenAudience,
) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
}

export async function verifyToken(token: string, aud: TokenAudience) {
    const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: aud,
        algorithms: ["HS256"],
    });
    return payload;
}
