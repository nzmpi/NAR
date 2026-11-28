// Vercel Routing Middleware: proxies /admin/* (API calls and the OIDC
// callback) to the backend so the browser sees one site and the SameSite=Lax
// cookie works. It adds ADMIN_PROXY_SECRET (a Vercel env var, never in git)
// and the visitor's IP, and sends them to BACKEND_URL; the backend refuses /admin requests without the
// secret and binds sessions to that IP.
export const config = { matcher: "/admin/:path*" };

declare const process: { env: Record<string, string | undefined> };

export default async function middleware(request: Request) {
    const secret = process.env.ADMIN_PROXY_SECRET;
    // Backend origin, a trailing slash is trimmed (a Vercel env var, like the secret).
    const backend = process.env.BACKEND_URL?.replace(/\/+$/, "");
    if (!secret || !backend)
        return new Response("Admin proxy not configured", { status: 500 });

    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("host");
    // Plain bodies: fetch would decompress but keep content-encoding.
    headers.set("accept-encoding", "identity");
    headers.set("x-nar-proxy-secret", secret);
    // Set by Vercel at the edge, so the visitor cannot choose it.
    headers.set("x-nar-client-ip", request.headers.get("x-real-ip") ?? "");

    const hasBody = !["GET", "HEAD"].includes(request.method);
    return fetch(backend + url.pathname + url.search, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: "manual",
    });
}
