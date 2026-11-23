import { IDLE_MS, MAX_MS, sessionExpiryMs } from "../src/auth/adminSession.js";

const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const DAY = 86_400_000;
const start = 1_000_000_000_000;

ok(IDLE_MS === 3 * DAY && MAX_MS === 10 * DAY, "3 days idle, 10 days max");
ok(sessionExpiryMs(start, start) === start + 3 * DAY, "login: 3 days");
ok(
    sessionExpiryMs(start, start + 5 * DAY) === start + 8 * DAY,
    "use on day 5 slides to day 8",
);
ok(
    sessionExpiryMs(start, start + 9 * DAY) === start + 10 * DAY,
    "use on day 9 is capped at day 10",
);
console.log("admin session ok");
