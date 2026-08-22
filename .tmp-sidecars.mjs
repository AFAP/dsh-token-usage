// Throwaway: inspect sidecar LLM request events (title/search/retry) + today's counts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 4247762216;
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error("bad magic");
    offset += 4;
    const descriptor = buffer.readUInt8(offset); offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    offset += remainingHeaderBytes;
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return { frames };
}
function decompress(buffer) {
  const { frames } = scanZstdFrames(buffer);
  const parts = [];
  for (const f of frames) parts.push(zstdDecompressSync(buffer.subarray(f.start, f.end)));
  return Buffer.concat(parts).toString("utf8");
}
function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TARGETS = new Set(["web/deepseek-search-llm-request", "session/title-llm-request", "llm/retry", "llm/retry-started", "subagent/descriptor"]);
const TODAY = dayOf(Date.now());
const root = join(homedir(), ".dsh", "sessions");
const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && e.name.endsWith(".jsonl.zstd")) files.push(full);
  }
})(root);

const todayCount = new Map();
const samples = new Map();
for (const path of files) {
  let text;
  try { text = decompress(readFileSync(path)); } catch { continue; }
  for (const line of text.split("\n")) {
    if (line.length < 16 || !line.includes("llm-request") && !line.includes("llm/retry") && !line.includes("subagent/descriptor")) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const type = ev && ev.type;
    if (!TARGETS.has(type)) continue;
    const day = typeof ev.time === "number" ? dayOf(ev.time) : "?";
    if (day === TODAY) bump(todayCount, type);
    if (!samples.has(type)) samples.set(type, ev);
  }
}
function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }

console.log("TODAY =", TODAY);
console.log("\n=== sidecar/special events TODAY ===");
[...todayCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(6), k));

console.log("\n=== sample data shapes ===");
for (const [type, ev] of samples) {
  console.log("\n---", type, "---");
  console.log(JSON.stringify(ev.data, null, 1).slice(0, 1200));
}