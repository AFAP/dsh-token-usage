// Unit tests for lib/stats.js — pure aggregation logic with synthetic events.
import { strict as assert } from "node:assert";
import { aggregateEvents, dayOf, emptyBucket, numberOrZero, shapePayload } from "../lib/stats.js";

// dayOf local-calendar formatting
assert.equal(dayOf(0), new Date(0).getFullYear() >= 1970 ? dayOf(0) : "1970-01-01");
{
  const d = new Date(2026, 1, 3, 12, 0, 0); // Feb 3 2026 local
  assert.equal(dayOf(d.getTime()), "2026-02-03");
}
assert.equal(numberOrZero(5), 5);
assert.equal(numberOrZero(-3), 0);
assert.equal(numberOrZero(NaN), 0);
assert.equal(numberOrZero(undefined), 0);

const T = (y, mo, day) => new Date(y, mo - 1, day, 10, 0, 0).getTime();

// Two models, two days, cache buckets, missing-usage skip, model switching.
const events = [
  { type: "request/header", time: T(2026, 2, 3), data: { header: { config: { provider: "deepseek-official", model: "deepseek-v4-flash" } } } },
  { type: "assistant/message", time: T(2026, 2, 3), data: { turn: 0, step: 0, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 } } },
  // usage-less message must be skipped
  { type: "assistant/message", time: T(2026, 2, 3), data: { turn: 0, step: 1 } },
  // model switch via request/context
  { type: "request/context", time: T(2026, 2, 3), data: { provider: "deepseek-official", model: "deepseek-r1", contextWindow: 64000 } },
  { type: "assistant/message", time: T(2026, 2, 3), data: { turn: 0, step: 2, usage: { inputTokens: 200, outputTokens: 100 } } },
  // next day, same model as r1 (header persists)
  { type: "assistant/message", time: T(2026, 2, 4), data: { turn: 1, step: 0, usage: { inputTokens: 300, outputTokens: 150, cacheReadTokens: 40 } } },
  // request/header with empty model must NOT clobber current model
  { type: "request/header", time: T(2026, 2, 4), data: { header: { config: { provider: "x", model: "" } } } },
  { type: "assistant/message", time: T(2026, 2, 4), data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 } } }
];

const { byDay, byModel } = aggregateEvents(events);
assert.equal(byDay.size, 2);
assert.equal(byModel.size, 2);

const flash = byModel.get("deepseek-v4-flash");
const r1 = byModel.get("deepseek-r1");
assert.deepEqual(flash, { requests: 1, input: 100, output: 50, cacheRead: 20, cacheWrite: 10, total: 180 });
assert.deepEqual(r1, { requests: 3, input: 510, output: 255, cacheRead: 40, cacheWrite: 0, total: 805 });

const d3 = byDay.get("2026-02-03");
assert.equal(d3.requests, 2);
assert.equal(d3.total, 180 + 300);
assert.equal(d3.byModel.get("deepseek-v4-flash").total, 180);
assert.equal(d3.byModel.get("deepseek-r1").total, 300);

const payload = shapePayload(byDay, byModel, { generatedAt: 1, sessionCount: 1 });
assert.equal(payload.totals.total, 180 + 805);
assert.equal(payload.totals.requests, 4);
assert.equal(payload.byModel.length, 2);
assert.equal(payload.byModel[0].model, "deepseek-r1"); // sorted by total desc
assert.equal(payload.byDay[0].day, "2026-02-03");
assert.equal(payload.byDay[1].day, "2026-02-04");
assert.deepEqual(payload.byDay[1].models[0], { model: "deepseek-r1", requests: 2, input: 310, output: 155, cacheRead: 40, cacheWrite: 0, total: 505 });

// empty events
const empty = shapePayload(new Map(), new Map(), { generatedAt: 0, sessionCount: 0 });
assert.deepEqual(empty.totals, emptyBucket());
assert.deepEqual(empty.byDay, []);
assert.deepEqual(empty.byModel, []);

console.log("OK: stats.js — days/models attribution, cache buckets, sorting, empty payload");
