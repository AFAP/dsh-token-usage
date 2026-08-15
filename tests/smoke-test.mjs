// Smoke test for the dsh-token-usage client bundle: simulate the browser
// module loader, stub the react seed words, materialize the factory, run the
// plugin body against a fake ctx (two slot registrations), and render every
// component branch (header pill closed/open/empty, sidebar action closed/open,
// global panel loading/ready/empty) without throwing.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

let handoff = null;
globalThis.window = globalThis;
globalThis.window.__ModuleLoader__ = {
  load(entry) {
    handoff = entry;
  },
};
globalThis.document = {
  head: { appendChild() {} },
  querySelector() {
    return null;
  },
  createElement() {
    return { dataset: {} };
  },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.fetch = async () => {
  throw new Error("fetch should not run in the smoke test (effects are stubbed)");
};

const noop = () => {};
/** A react stub whose useState returns pinned values per call index. */
function makeReact(pins = []) {
  let call = 0;
  return {
    useState(init) {
      const value = call < pins.length ? pins[call] : typeof init === "function" ? init() : init;
      call += 1;
      return [value, noop];
    },
    useEffect: noop,
    useRef: () => ({ current: null }),
    useCallback: (fn) => fn,
    Fragment: "Fragment",
    createElement: noop,
  };
}
const jsxRuntimeStub = { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };

const requireStub = (spec) => {
  if (spec === "react") return makeReact();
  if (spec === "react/jsx-runtime") return jsxRuntimeStub;
  throw new Error(`unexpected require: ${spec}`);
};

// 1) Execute the bundle: it must register via window.__ModuleLoader__.load.
new Function(source)();
if (!handoff) throw new Error("bundle did not call __ModuleLoader__.load");
if (handoff.id !== "dsh-token-usage") throw new Error(`bad bundle id: ${handoff.id}`);
if (typeof handoff.factory !== "function") throw new Error("factory missing");

// 2) Materialize the factory.
const mod = handoff.factory(requireStub);
if (typeof mod.apply !== "function") throw new Error("module exports no apply");
if (!Array.isArray(mod.inject) || !mod.inject.includes("slots") || !mod.inject.includes("locale")) {
  throw new Error(`bad inject list: ${JSON.stringify(mod.inject)}`);
}

// 3) Run the plugin body against a fake ctx; expect TWO slot contributions.
const registered = new Map();
const fakeCtx = {
  effect(fn) {
    const dispose = fn();
    return () => (typeof dispose === "function" ? dispose() : undefined);
  },
  locale: {
    register(ns, dicts) {
      if (ns !== "token-usage") throw new Error(`bad locale ns: ${ns}`);
      if (!dicts.zh || !dicts.en) throw new Error("locale dictionaries missing a language");
      return () => {};
    },
  },
  slots: {
    inject(key, callback) {
      callback();
    },
    register(options, component) {
      if (typeof component !== "function") throw new Error("registered component is not a function");
      registered.set(options.id, { options, component });
      return () => {};
    },
  },
};
mod.apply(fakeCtx);
if (registered.size !== 2) throw new Error(`expected 2 slot contributions, got ${registered.size}`);
const badge = registered.get("token-usage");
const globalAction = registered.get("token-usage-global");
if (!badge || badge.options.name !== "conversation.session.header.utilities") throw new Error("header badge registration missing or wrong");
if (!globalAction || globalAction.options.name !== "sidebar.footer.action") throw new Error("sidebar action registration missing or wrong");

// 4) Render-path smoke for every branch.
const t = (key) => key;
const sampleData = {
  generatedAt: Date.now(),
  sessionCount: 3,
  totals: { requests: 5, input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, total: 3500 },
  byDay: [
    { day: "2026-02-10", requests: 2, input: 300, output: 200, cacheRead: 400, cacheWrite: 0, total: 900, models: [{ model: "deepseek-v4-flash", requests: 2, input: 300, output: 200, cacheRead: 400, cacheWrite: 0, total: 900 }] },
    { day: "2026-02-11", requests: 3, input: 700, output: 300, cacheRead: 1600, cacheWrite: 0, total: 2600, models: [{ model: "deepseek-v4-pro", requests: 3, input: 700, output: 300, cacheRead: 1600, cacheWrite: 0, total: 2600 }] }
  ],
  byModel: [
    { model: "deepseek-v4-flash", requests: 2, input: 300, output: 200, cacheRead: 400, cacheWrite: 0, total: 900 },
    { model: "deepseek-v4-pro", requests: 3, input: 700, output: 300, cacheRead: 1600, cacheWrite: 0, total: 2600 }
  ]
};

function loadWith(pins) {
  const probe = new Function(source);
  globalThis.window.__ModuleLoader__ = { load(entry) { handoff = entry; } };
  probe();
  const m = handoff.factory((spec) => {
    if (spec === "react") return makeReact(pins);
    if (spec === "react/jsx-runtime") return jsxRuntimeStub;
    return requireStub(spec);
  });
  const found = new Map();
  m.apply({
    effect: () => () => {},
    locale: { register: () => () => {} },
    slots: { inject: (key, cb) => { cb(); }, register: (o, c) => { found.set(o.id, c); return () => {}; } },
  });
  return found;
}

const projections = {
  tokenUsage: { uncachedInputTokens: 1234, outputTokens: 356, cacheReadTokens: 200, cacheWriteTokens: 50 },
  contextPressure: { contextWindow: 28000, pressureTokens: 12000, projectedTokens: 13600 },
  contextBreakdown: { systemTokens: 800, toolsTokens: 900, messageTokens: 3200 },
  sessionStats: { turns: 3, steps: 8, llmMs: 45000, toolMs: 23000, ttftMs: 6200, ttftSteps: 8, decodeMs: 38000, decodeTokens: 12000 },
};
const useProjection = (key) => projections[key];
let projectionReads = 0;
const countingProjection = (key) => {
  projectionReads += 1;
  return projections[key];
};

// 4a. Header badge: closed, open (popover), and empty-data.
for (const [open, empty] of [[false, false], [true, false], [true, true]]) {
  const found = loadWith([open]);
  found.get("token-usage")({
    sessionId: "s1",
    useProjection: empty ? () => undefined : countingProjection,
    t,
  });
}
// 4b. Sidebar action: closed (rail), closed (wide), open -> panel loading.
for (const wide of [false, true]) {
  const found = loadWith([false]);
  found.get("token-usage-global")({ wide, t });
}
// 4c. Sidebar action open -> GlobalStatsPanel first state = loading.
{
  const found = loadWith([true]);
  found.get("token-usage-global")({ wide: true, t });
}
// 4d. GlobalStatsPanel ready branch: pin action-open=true, panel-state=ready.
{
  const found = loadWith([true, { status: "ready", data: sampleData, error: null }]);
  found.get("token-usage-global")({ wide: true, t });
}
// 4e. GlobalStatsPanel empty branch: totals all zero.
{
  const found = loadWith([true, {
    status: "ready",
    data: { generatedAt: Date.now(), sessionCount: 1, totals: { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, byDay: [], byModel: [] },
    error: null,
  }]);
  found.get("token-usage-global")({ wide: true, t });
}
// 4f. GlobalStatsPanel error branch.
{
  const found = loadWith([true, { status: "error", data: null, error: "HTTP 500" }]);
  found.get("token-usage-global")({ wide: true, t });
}

if (projectionReads < 4) throw new Error("useProjection never called on the badge data path");
console.log(`OK: bundle id=${handoff.id}, inject=${mod.inject.join(",")}, 2 slot contributions; render branches: badge(closed/open/empty), action(rail/wide/open), panel(loading/ready/empty/error) — ${projectionReads} projection reads`);
