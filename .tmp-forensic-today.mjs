// Throwaway forensic scan of RAW dsh session logs for TODAY. Not committed.
// Verbatim port of the plugin's zstd frame handling (index.js), then a WIDER
// parse than the plugin itself: no line-filter, full event-type census.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid magic at ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved header bit at ${offset - 1}`);
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
      if (blockType === 3) throw new Error(`reserved block type at ${offset - 3}`);
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

function decompressSessionLog(buffer, isZstd) {
  if (!isZstd) return buffer.toString("utf8");
  const { frames } = scanZstdFrames(buffer);
  const parts = [];
  for (const frame of frames) parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
  return Buffer.concat(parts).toString("utf8");
}

function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = dayOf(Date.now());
console.log("local today =", TODAY);

const root = join(process.env.DSH_HOME && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh"), "sessions");
const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".jsonl.zstd")) files.push(full);
  }
})(root);
console.log("total session files:", files.length);

let errors = 0;
const eventTypeCensus = new Map();          // event.type -> count (ALL time)
const usageKeyCensus = new Map();           // JSON.stringify(sorted usage keys) -> count (today)
const nonMessageUsageLines = new Map();     // event.type carrying "usage" but not assistant/message -> count
const todayByModel = new Map();             // model -> bucket (today)
const allTimeByModel = new Map();           // model -> requests+total (all time)
let todayRequestsTotal = 0, todayTokensTotal = 0;
let tornFrames = 0, parseFailLines = 0;

function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }

for (const path of files) {
  let buffer;
  try { buffer = readFileSync(path); } catch { errors++; continue; }
  let text;
  try { text = decompressSessionLog(buffer, true); } catch (e) { errors++; console.log("DECOMP FAIL:", path, String(e).slice(0, 120)); continue; }
  const lines = text.split("\n");
  let currentModel = "unknown";
  for (const line of lines) {
    if (line.length < 8) continue;
    let event;
    try { event = JSON.parse(line); } catch { parseFailLines++; continue; }
    const type = event && event.type;
    if (typeof type !== "string") continue;
    bump(eventTypeCensus, type);
    if (type === "request/header") {
      const model = event.data && event.data.header && event.data.header.config && event.data.header.config.model;
      if (typeof model === "string" && model !== "") currentModel = model;
    } else if (type === "request/context") {
      const model = event.data && event.data.model;
      if (typeof model === "string" && model !== "") currentModel = model;
    } else if (event.data && typeof event.data === "object" && event.data.usage !== undefined && type !== "assistant/message") {
      bump(nonMessageUsageLines, type);
    }
    if (type !== "assistant/message") continue;
    const usage = event.data && event.data.usage;
    if (typeof usage !== "object" || usage === null) continue;
    bump(usageKeyCensus, JSON.stringify(Object.keys(usage).sort()));
    const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
    const input = n(usage.inputTokens), output = n(usage.outputTokens), cr = n(usage.cacheReadTokens), cw = n(usage.cacheWriteTokens), rs = n(usage.reasoningTokens);
    const total = input + output + cr + cw;
    const day = typeof event.time === "number" ? dayOf(event.time) : "?";
    if (!allTimeByModel.has(currentModel)) allTimeByModel.set(currentModel, { req: 0, total: 0 });
    const allEntry = allTimeByModel.get(currentModel);
    allEntry.req++; allEntry.total += total;
    if (day === TODAY) {
      if (!todayByModel.has(currentModel)) todayByModel.set(currentModel, { req: 0, input: 0, output: 0, cr: 0, cw: 0, rs: 0, total: 0 });
      const b = todayByModel.get(currentModel);
      b.req++; b.input += input; b.output += output; b.cr += cr; b.cw += cw; b.rs += rs; b.total += total;
      todayRequestsTotal++; todayTokensTotal += total;
    }
  }
}

console.log("\n=== files with read/decompress errors:", errors, "| torn-ish unparsed lines:", parseFailLines, "===");

console.log("\n=== event-type census (all time) ===");
[...eventTypeCensus.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(9), k));

console.log("\n=== usage-object key shapes seen (today) ===");
[...usageKeyCensus.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(9), k));

console.log("\n=== NON assistant/message event types carrying data.usage (all time) ===");
if (nonMessageUsageLines.size === 0) console.log("(none)");
[...nonMessageUsageLines.entries()].forEach(([k, v]) => console.log(String(v).padStart(9), k));

console.log("\n=== TODAY by model (RAW logs, independent of plugin cache) ===");
let sum = 0;
[...todayByModel.entries()].sort((a, b) => b[1].total - a[1].total).forEach(([m, b]) => {
  sum += b.total;
  console.log(m.padEnd(28), "req", String(b.req).padStart(6), "in", String(b.input).padStart(12), "out", String(b.output).padStart(10), "cacheR", String(b.cr).padStart(12), "cacheW", String(b.cw).padStart(10), "reason", String(b.rs).padStart(8), "total", String(b.total).padStart(13));
});
console.log("TODAY requests:", todayRequestsTotal, "| tokens:", todayTokensTotal, "(model rows sum:", sum + ")");

console.log("\n=== ALL-TIME by model (sanity vs panel 累计 2244.2M) ===");
let allSum = 0, allReq = 0;
[...allTimeByModel.entries()].sort((a, b) => b[1].total - a[1].total).forEach(([m, b]) => { allSum += b.total; allReq += b.req; });
console.log("models:", allTimeByModel.size, "| all-time requests:", allReq, "| all-time tokens:", allSum);
