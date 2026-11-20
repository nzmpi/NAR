import { beat, workerStatus } from "../src/heartbeat.js";

const ok = (c: unknown, m: string) => {
    if (!c) throw new Error("FAIL " + m);
    console.log("ok  " + m);
};
const now = Date.now();
const MIN = 60_000;

ok(workerStatus("scanner", 0) === "off", "interval 0 -> off");
ok(workerStatus("scanner", 60, now) === "ok", "fresh start -> ok");
ok(workerStatus("scanner", 60, now + 9 * MIN) === "ok", "10 min floor");
ok(
    workerStatus("scanner", 60, now + 11 * MIN) === "stalled",
    "11 min -> stalled",
);
beat("scanner", now + 11 * MIN);
ok(workerStatus("scanner", 60, now + 12 * MIN) === "ok", "after beat -> ok");
ok(
    workerStatus("outbox", 5, now + 9 * MIN) === "ok",
    "floor for short intervals",
);
ok(
    workerStatus("scanner", 600, now + 51 * MIN) === "ok",
    "5x interval for long intervals",
);
ok(
    workerStatus("scanner", 600, now + 62 * MIN) === "stalled",
    "past 5x interval -> stalled",
);
console.log("heartbeat ok");
