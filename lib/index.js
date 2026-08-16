// Node half of the dsh-token-usage plugin.
//
// Host-side behavior: serves the global token-consumption statistics panel's
// data. On GET /api/token-stats it scans the harness session logs
// ($DSH_HOME/sessions — zstd-compressed JSONL produced by
// dsh-session-persistence-jsonl), folds the provider-reported `usage` of
// every `assistant/message` event into day- and model-keyed buckets (the
// model comes from the nearest preceding `request/header` /
// `request/context` event), and returns a JSON payload. Aggregation results
// are memoized per file mtime/size, so repeated panel refreshes are cheap.
//
// The route is registered as an EXACT match on the webserver, which wins
// over the connection plugin's /api prefix, so this handler applies its own
// browser-trust fence (loopback or declared trustedHosts + same-origin
// checks) mirroring the /api fence in @deepseek-ai/dsh-client-connection.
//
// DELIBERATELY DEPENDENCY-FREE: this module imports only Node builtins and
// ./stats.js. Out-of-tree plugins resolve their bare imports from the
// package's REAL location, which is only guaranteed to sit inside the profile
// tree when pnpm manages the install; keeping the host half self-contained
// makes it load correctly from any install method (git, registry, file:,
// link:). DSH_HOME is resolved from the environment exactly like
// @deepseek-ai/dsh-home-paths does (no configured override here).
//
// The browser half ships via exports["./client"]; this package is also a
// loader entry (the row inserted by cordis.patch.yml) whose `dsh.client`
// declaration is what the client-modules registry scans into
// window.__DSH_BOOT__.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { addBucket, aggregateEvents, emptyBucket, shapePayload } from "./stats.js";

/** Stable Cordis plugin name. */
const name = "token-usage";
/** Services required before the route can be claimed. */
const inject = ["webServer"];

/** Resolve the harness sessions root: $DSH_HOME/sessions, else ~/.dsh/sessions. */
function sessionsRoot() {
  const env = process.env.DSH_HOME;
  const home = typeof env === "string" && env.trim() !== "" ? env.trim() : join(homedir(), ".dsh");
  return join(home, "sessions");
}

/** Read the validated `trustedHosts` list from the row config (never throws). */
function trustedHostsOf(config) {
  const value = config && config.trustedHosts;
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/** Lines that can carry usage or model attribution. */
const RELEVANT_LINE = /"(?:assistant\/message|request\/header|request\/context)"/;
/** Shortest relevant line is far longer; cheap length gate before the regex. */
const MIN_LINE_LENGTH = 32;

// ── zstd frame container (dsh-session-persistence-jsonl format) ────────────
// Session logs are a CONCATENATION of independent, checksummed zstd frames
// (one per appended batch). Node's one-shot/streaming decoders only see the
// first frame, so the backend locates frame boundaries structurally and
// decompresses each frame separately. The scanner below is the same algorithm
// (frame magic + descriptor + block walk + checksum) from
// @deepseek-ai/dsh-session-persistence-jsonl (MIT).

/** Zstandard frame magic, little-endian 0xFD2FB528. */
const ZSTD_MAGIC = 4247762216;

/**
 * Locate complete frames without decompressing their blocks. Invalid complete
 * structure rejects; EOF inside the final frame returns its start for repair.
 * @param buffer - complete bytes of a session artifact.
 * @returns complete frame ranges and an optional incomplete-final-frame start.
 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/**
 * Decompress a session-log artifact into its full JSONL text. Handles both
 * plaintext files and concatenated-frame zstd files; a torn final frame
 * (crash mid-append) is skipped and the complete frames are returned.
 */
function decompressSessionLog(buffer, isZstd) {
  if (!isZstd) return buffer.toString("utf8");
  const { frames } = scanZstdFrames(buffer);
  const parts = [];
  for (const frame of frames) parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
  return Buffer.concat(parts).toString("utf8");
}

/**
 * Decompress (when zstd) and parse the events of one session log.
 * Torn trailing lines (a crash mid-append) fail JSON.parse and are skipped.
 */
function eventsFromBuffer(buffer, isZstd) {
  const events = [];
  for (const line of decompressSessionLog(buffer, isZstd).split("\n")) {
    if (line.length < MIN_LINE_LENGTH) continue;
    if (!RELEVANT_LINE.test(line)) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip a torn line
    }
  }
  return events;
}

// ── browser-trust fence (mirrors @deepseek-ai/dsh-client-connection) ──────

/** Whether a WHATWG hostname names the loopback authority. */
function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Whether the request's Host authority is loopback or a declared trusted host. */
function isTrustedAuthority(hostUrl, trustedHosts) {
  if (isLoopbackHostname(hostUrl.hostname)) return true;
  return trustedHosts.some((entry) => {
    let entryUrl;
    try {
      entryUrl = new URL(`http://${entry}`);
    } catch {
      return false;
    }
    return entryUrl.port === "" ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
  });
}

/** Decide whether one request may reach /api/token-stats. */
function isTrustedRequest(req, trustedHosts) {
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// ── session-log scanning ───────────────────────────────────────────────────

/** Recursively collect session log files under a root directory. */
async function listSessionFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name.endsWith(".jsonl.zstd"))) {
        try {
          const info = await stat(full);
          files.push({ path: full, mtimeMs: info.mtimeMs, size: info.size });
        } catch {
          // unreadable file — skip; next refresh may see it
        }
      }
    }
  }
  await walk(root);
  return files;
}

/** Merge one file's aggregated buckets into the global maps (mutates maps). */
function mergeBuckets(byDay, byModel, result) {
  for (const [day, bucket] of result.byDay) {
    let target = byDay.get(day);
    if (target === void 0) {
      target = Object.assign(emptyBucket(), { byModel: new Map(), hours: new Map() });
      byDay.set(day, target);
    }
    addBucket(target, bucket);
    for (const [model, modelBucket] of bucket.byModel) {
      let dayModel = target.byModel.get(model);
      if (dayModel === void 0) {
        dayModel = emptyBucket();
        target.byModel.set(model, dayModel);
      }
      addBucket(dayModel, modelBucket);
    }
    for (const [hour, hourBucket] of bucket.hours) {
      let dayHour = target.hours.get(hour);
      if (dayHour === void 0) {
        dayHour = emptyBucket();
        target.hours.set(hour, dayHour);
      }
      addBucket(dayHour, hourBucket);
    }
  }
  for (const [model, bucket] of result.byModel) {
    let target = byModel.get(model);
    if (target === void 0) {
      target = emptyBucket();
      byModel.set(model, target);
    }
    addBucket(target, bucket);
  }
}

// ── the /api/token-stats endpoint ──────────────────────────────────────────

/** Per-file aggregation memo, keyed by path and invalidated by mtime/size. */
const fileCache = new Map();

/** Read + aggregate one session log, reusing the memo when the file is unchanged. */
async function aggregateFile(ctx, file) {
  const memo = fileCache.get(file.path);
  if (memo !== void 0 && memo.mtimeMs === file.mtimeMs && memo.size === file.size) return memo.result;
  let buffer;
  try {
    buffer = await readFile(file.path);
  } catch {
    return null;
  }
  let events;
  try {
    events = eventsFromBuffer(buffer, file.path.endsWith(".zstd"));
  } catch (error) {
    ctx.logger.warn(`token-usage: skipping ${file.path}: ${String(error)}`);
    return null;
  }
  const result = aggregateEvents(events);
  fileCache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, result });
  return result;
}

/** Compute the global token-usage stats payload (per-file memoized). */
async function computeStats(ctx) {
  const root = sessionsRoot();
  const files = await listSessionFiles(root);
  const now = Date.now();
  const byDay = new Map();
  const byModel = new Map();
  for (const file of files) {
    const result = await aggregateFile(ctx, file);
    if (result !== null) mergeBuckets(byDay, byModel, result);
  }
  // Drop memos for files that no longer exist (deleted sessions).
  const live = new Set(files.map((file) => file.path));
  for (const path of fileCache.keys()) if (!live.has(path)) fileCache.delete(path);
  return shapePayload(byDay, byModel, {
    generatedAt: now,
    sessionCount: files.length
  });
}

/** Build the route handler bound to this plugin's context and config. */
function createHandler(ctx, config) {
  const trustedHosts = trustedHostsOf(config);
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (!isTrustedRequest(req, trustedHosts)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const payload = await computeStats(ctx);
      const body = JSON.stringify(payload);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(req.method === "HEAD" ? void 0 : body);
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
    }
  };
}

/**
 * Register the stats route. The exact path wins over the /api prefix in the
 * webserver's match, and the disposer releases the route on plugin unload.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - row config; `trustedHosts` (from webRuntime) feeds the fence.
 */
function apply(ctx, config) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/token-stats",
    handler: createHandler(ctx, config)
  }), "token-usage: /api/token-stats route");
}

export { apply, inject, name };
