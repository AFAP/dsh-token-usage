// End-to-end verification against the user's REAL session logs: walk
// $DSH_HOME/sessions, decompress the concatenated-zstd JSONL artifacts,
// parse events, fold usage through lib/stats.js, and print the aggregate.
// This proves the exact pipeline the host half (lib/index.js) runs at
// request time, including multi-frame zstd handling.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { aggregateEvents, emptyBucket, shapePayload } from "../lib/stats.js";

const ROOT = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh", "sessions");
const RELEVANT = /"(?:assistant\/message|request\/header|request\/context)"/;
const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad magic at ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
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
      if (blockType === 3) throw new Error("reserved block type");
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

function decompress(buffer, isZstd) {
  if (!isZstd) return buffer.toString("utf8");
  const { frames } = scanZstdFrames(buffer);
  const parts = [];
  for (const f of frames) parts.push(zstdDecompressSync(buffer.subarray(f.start, f.end)));
  return Buffer.concat(parts).toString("utf8");
}

function eventsFromBuffer(buffer, isZstd) {
  const events = [];
  for (const line of decompress(buffer, isZstd).split("\n")) {
    if (line.length < 32 || !RELEVANT.test(line)) continue;
    try { events.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  return events;
}

async function listFiles(dir) {
  const files = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name.endsWith(".jsonl.zstd"))) {
      try { const info = await stat(full); files.push({ path: full, mtimeMs: info.mtimeMs, size: info.size }); } catch { /* skip */ }
    }
  }
  return files;
}

function merge(target, source) {
  for (const [key, bucket] of source) {
    let t = target.get(key);
    if (t === void 0) {
      t = emptyBucket();
      target.set(key, t);
    }
    if (bucket.byModel instanceof Map) {
      if (!(t.byModel instanceof Map)) t.byModel = new Map();
      for (const [m, b] of bucket.byModel) {
        const tm = t.byModel.get(m) ?? emptyBucket();
        tm.requests += b.requests; tm.input += b.input; tm.output += b.output;
        tm.cacheRead += b.cacheRead; tm.cacheWrite += b.cacheWrite; tm.total += b.total;
        t.byModel.set(m, tm);
      }
    }
    t.requests += bucket.requests; t.input += bucket.input; t.output += bucket.output;
    t.cacheRead += bucket.cacheRead; t.cacheWrite += bucket.cacheWrite; t.total += bucket.total;
  }
}

const started = Date.now();
const files = await listFiles(ROOT);
const byDay = new Map();
const byModel = new Map();
let skipped = 0;
let eventsSeen = 0;

for (const file of files) {
  let buffer, events;
  try {
    buffer = await readFile(file.path);
    events = eventsFromBuffer(buffer, file.path.endsWith(".zstd"));
  } catch {
    skipped++;
    continue;
  }
  eventsSeen += events.length;
  const result = aggregateEvents(events);
  merge(byDay, result.byDay);
  merge(byModel, result.byModel);
}

const payload = shapePayload(byDay, byModel, { generatedAt: Date.now(), sessionCount: files.length });

console.log(`scanned ${files.length} session files (${skipped} skipped, ${eventsSeen} relevant events) in ${Date.now() - started}ms`);
console.log("totals:", JSON.stringify(payload.totals));
console.log("byModel:", JSON.stringify(payload.byModel, null, 2));
console.log("byDay (last 10):", JSON.stringify(payload.byDay.slice(-10), null, 2));
