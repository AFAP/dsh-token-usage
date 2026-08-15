// Host-plugin test: import the real lib/index.js (dependency-free — only Node
// builtins + ./stats.js, so no junction needed) and exercise the
// /api/token-stats route handler against fake requests — including a real
// end-to-end scan of $DSH_HOME/sessions on the trusted path.
import { strict as assert } from "node:assert";

const mod = await import("../lib/index.js");

assert.equal(mod.name, "token-usage");
assert.deepEqual(mod.inject, ["webServer"]);
assert.equal(typeof mod.apply, "function");
assert.ok(mod.Config === void 0, "dependency-free host half exports no Config schema");

const registrations = [];
const fakeCtx = {
  effect(fn) {
    const dispose = fn();
    return () => (typeof dispose === "function" ? dispose() : undefined);
  },
  webServer: {
    register(route) {
      registrations.push(route);
      return () => {};
    }
  },
  logger: { warn: (...args) => console.warn("ctx.logger.warn:", ...args) }
};
const fakeConfig = { trustedHosts: ["harness.internal"] };
mod.apply(fakeCtx, fakeConfig);
assert.equal(registrations.length, 1, "one route registered");
const route = registrations[0];
assert.equal(route.kind, "exact");
assert.equal(route.path, "/api/token-stats");
assert.equal(typeof route.handler, "function");

function fakeRes() {
  const state = { status: null, body: undefined };
  return {
    state,
    res: {
      writeHead(s) { state.status = s; },
      end(b) { state.body = b; }
    }
  };
}
function fakeReq(overrides) {
  return {
    method: "GET",
    headers: { host: "127.0.0.1:3080", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3080" },
    ...overrides
  };
}

// 405 — non-GET/HEAD
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({ method: "POST" }), res);
  assert.equal(state.status, 405);
}
// 403 — untrusted Host (DNS rebinding defense)
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({ headers: { host: "evil.example", origin: "http://evil.example" } }), res);
  assert.equal(state.status, 403);
}
// 403 — cross-site browser marker
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({ headers: { host: "127.0.0.1:3080", "sec-fetch-site": "cross-site" } }), res);
  assert.equal(state.status, 403);
}
// 403 — origin mismatch
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({ headers: { host: "127.0.0.1:3080", origin: "http://attacker.example" } }), res);
  assert.equal(state.status, 403);
}
// 200 — trusted loopback request, real scan of $DSH_HOME/sessions
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({}), res);
  assert.equal(state.status, 200);
  const payload = JSON.parse(state.body);
  assert.equal(typeof payload.totals, "object");
  assert.ok(Array.isArray(payload.byDay));
  assert.ok(Array.isArray(payload.byModel));
  assert.ok(typeof payload.sessionCount === "number");
  assert.ok(payload.generatedAt > 0);
  console.log("host handler OK: 200 with totals", JSON.stringify(payload.totals), `(${payload.sessionCount} sessions)`);
}
// HEAD — no body
{
  const { res, state } = fakeRes();
  await route.handler(fakeReq({ method: "HEAD" }), res);
  assert.equal(state.status, 200);
  assert.equal(state.body, void 0);
}

console.log("OK: host plugin — contract, trust fence, route handler, real-data scan");
