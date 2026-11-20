// In-memory "last good tick" per background loop, read by GET /health/ready.
type Worker = "scanner" | "outbox";
const beats: Record<Worker, number> = { scanner: 0, outbox: 0 };
const startedAt = Date.now();

export const beat = (w: Worker, now = Date.now()) => {
    beats[w] = now;
};

// Stalled when no good tick for 5 intervals (at least 10 minutes). 0 = loop disabled.
export function workerStatus(
    w: Worker,
    intervalSeconds: number,
    now = Date.now(),
): "ok" | "off" | "stalled" {
    if (intervalSeconds === 0) return "off";
    const limitMs = Math.max(5 * intervalSeconds, 600) * 1000;
    return now - (beats[w] || startedAt) > limitMs ? "stalled" : "ok";
}
