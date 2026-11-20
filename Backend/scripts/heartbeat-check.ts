import { beat, workerStatus } from "../src/heartbeat.js";

const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const now = Date.now();
const MIN = 60_000;

ok(workerStatus("scanner", 0) === "off", "interval 0 -> off");
ok(workerStatus("scanner", 60, now) === "ok", "fresh start -> ok");
ok(
    workerStatus("scanner", 60, now + 6 * MIN) === "stalled",
    "no beat for 6 min -> stalled",
);
beat("scanner", now + 6 * MIN);
ok(workerStatus("scanner", 60, now + 7 * MIN) === "ok", "after beat -> ok");
ok(
    workerStatus("outbox", 5, now + 4 * MIN) === "ok",
    "5 min floor for short intervals",
);
ok(
    workerStatus("scanner", 600, now + 6 * MIN + 40 * MIN) === "ok",
    "5x interval for long intervals",
);
ok(
    workerStatus("scanner", 600, now + 6 * MIN + 51 * MIN) === "stalled",
    "past 5x interval -> stalled",
);
console.log("heartbeat ok");
