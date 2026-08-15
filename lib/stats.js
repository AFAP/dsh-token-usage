// Pure token-usage aggregation for DeepSeek Harness session logs.
//
// Deliberately dependency-free (no Node imports): the host plugin
// (lib/index.js) folds real session events through it, and offline
// verification scripts can import it directly. All functions are pure —
// maps in, plain JSON-able objects out.
//
// Data model (from the dsh session-log schema):
//   - `assistant/message` events carry `data.usage?: TokenUsage`
//     { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }
//   - the model for a step is the latest `request/header` event's
//     `data.header.config.model`, or the latest `request/context` event's
//     `data.model` (logged when the route changes)
//   - `event.time` is Unix epoch milliseconds → local calendar day

/** Local calendar day "YYYY-MM-DD" for a Unix-epoch-ms timestamp. */
export function dayOf(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A finite positive number, else 0 (missing usage fields count as zero). */
export function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A fresh usage bucket (token counts are disjoint; total = sum of all four). */
export function emptyBucket() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/** Fold one `assistant/message` usage record into a bucket, mutating it. */
export function addUsage(bucket, usage) {
  const input = numberOrZero(usage && usage.inputTokens);
  const output = numberOrZero(usage && usage.outputTokens);
  const cacheRead = numberOrZero(usage && usage.cacheReadTokens);
  const cacheWrite = numberOrZero(usage && usage.cacheWriteTokens);
  bucket.requests += 1;
  bucket.input += input;
  bucket.output += output;
  bucket.cacheRead += cacheRead;
  bucket.cacheWrite += cacheWrite;
  bucket.total += input + output + cacheRead + cacheWrite;
}

/** Add one bucket's counts into another (mutates `target`). */
export function addBucket(target, source) {
  target.requests += source.requests;
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.total += source.total;
}

/**
 * Fold parsed session events into day- and model-keyed usage buckets.
 * @param events - parsed session events (or event-like objects).
 * @returns `{ byDay, byModel }` — `byDay` maps "YYYY-MM-DD" to a bucket that
 *   also carries a nested `byModel` Map; `byModel` maps model id to a bucket.
 */
export function aggregateEvents(events) {
  const byDay = new Map();
  const byModel = new Map();
  let currentModel = "unknown";
  for (const event of events) {
    const type = event && event.type;
    if (type === "request/header") {
      const model = event.data && event.data.header && event.data.header.config && event.data.header.config.model;
      if (typeof model === "string" && model !== "") currentModel = model;
    } else if (type === "request/context") {
      const model = event.data && event.data.model;
      if (typeof model === "string" && model !== "") currentModel = model;
    } else if (type === "assistant/message") {
      const usage = event.data && event.data.usage;
      if (typeof usage !== "object" || usage === null) continue;
      const day = dayOf(event.time);
      let dayBucket = byDay.get(day);
      if (dayBucket === void 0) {
        dayBucket = Object.assign(emptyBucket(), { byModel: new Map() });
        byDay.set(day, dayBucket);
      }
      let modelBucket = byModel.get(currentModel);
      if (modelBucket === void 0) {
        modelBucket = emptyBucket();
        byModel.set(currentModel, modelBucket);
      }
      let dayModelBucket = dayBucket.byModel.get(currentModel);
      if (dayModelBucket === void 0) {
        dayModelBucket = emptyBucket();
        dayBucket.byModel.set(currentModel, dayModelBucket);
      }
      addUsage(dayBucket, usage);
      addUsage(modelBucket, usage);
      addUsage(dayModelBucket, usage);
    }
  }
  return { byDay, byModel };
}

/** One serializable model entry (bucket plus its model id). */
function modelEntry(model, bucket) {
  return {
    model,
    requests: bucket.requests,
    input: bucket.input,
    output: bucket.output,
    cacheRead: bucket.cacheRead,
    cacheWrite: bucket.cacheWrite,
    total: bucket.total
  };
}

/**
 * Shape aggregated maps into the wire payload served by /api/token-stats.
 * @param byDay - day-keyed buckets (with nested byModel Maps).
 * @param byModel - model-keyed buckets.
 * @param meta - extra top-level fields (generatedAt, sessionCount).
 * @returns a JSON-serializable stats payload.
 */
export function shapePayload(byDay, byModel, meta) {
  const totals = emptyBucket();
  const byModelEntries = [...byModel.entries()]
    .map(([model, bucket]) => modelEntry(model, bucket))
    .sort((a, b) => b.total - a.total || b.requests - a.requests);
  for (const entry of byModelEntries) addBucket(totals, entry);
  const byDayEntries = [...byDay.entries()]
    .map(([day, bucket]) => {
      const models = [...bucket.byModel.entries()]
        .map(([model, modelBucket]) => modelEntry(model, modelBucket))
        .sort((a, b) => b.total - a.total);
      return {
        day,
        requests: bucket.requests,
        input: bucket.input,
        output: bucket.output,
        cacheRead: bucket.cacheRead,
        cacheWrite: bucket.cacheWrite,
        total: bucket.total,
        models
      };
    })
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return {
    ...meta,
    totals,
    byDay: byDayEntries,
    byModel: byModelEntries
  };
}
