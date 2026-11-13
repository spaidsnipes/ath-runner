// node --test runner/studios-render.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readZip, validateEdl, buildArgs, PIXEL_FRAMES } from "./studios-render.mjs";
function zip(entries, method = 0) { // stored zip, same layout as the browser writes
  const bufs = []; for (const [name, data] of entries) { const n = Buffer.from(name), d = Buffer.from(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(method, 8); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26); bufs.push(h, n, d); }
  return Buffer.concat(bufs); }
test("bundle: stored entries only, safe names only", () => {
  const m = readZip(zip([["edl.json", "{}"], ["m0.mp4", "x"]])); assert.deepEqual([...m.keys()], ["edl.json", "m0.mp4"]);
  assert.throws(() => readZip(zip([["../x", "1"]])), /name not allowed/);
  assert.throws(() => readZip(zip([["a.json", "1"]], 8)), /compressed/);
});
const files = new Map([["m0.mp4", Buffer.alloc(1)], ["mix.wav", Buffer.alloc(1)], ["l0.cube", Buffer.alloc(1)]]);
const base = { v: 1, w: 3840, h: 2160, fps: 30, frames: 90, media: [{ id: "a", file: "m0.mp4" }], luts: [{ id: "L", file: "l0.cube" }],
  layers: [{ media: "a", start: 0, dur: 90, lut: { id: "L", mix: 0.5 }, color: { b: 10, w: 20 } }], texts: [{ kind: "title", text: "Hi\nthere", start: 0, dur: 30, px: 120 }], mix: "mix.wav" };
test("edl: sizes, budget, unknown files and media refused", () => {
  assert.equal(validateEdl(base, files).layers.length, 1);
  assert.throws(() => validateEdl({ ...base, w: 4000 }, files), /not offered/);
  assert.throws(() => validateEdl({ ...base, frames: Math.ceil(PIXEL_FRAMES / (3840 * 2160)) + 1 }, files), /too long/);
  assert.throws(() => validateEdl({ ...base, media: [{ id: "a", file: "nope.mp4" }] }, files), /missing/);
  assert.throws(() => validateEdl({ ...base, layers: [{ media: "zzz" }] }, files), /unknown media/);
  assert.equal(validateEdl({ ...base, w: 1920, h: 1080, frames: 30 * 180 }, files).frames, 5400);
});
test("graph: text only through files, LUT mix blended, mix mapped, 4K level", () => {
  const E = validateEdl(base, files), dir = (globalThis.process.env.TMPDIR || "/tmp").replace(/\/$/, "");
  const a = buildArgs(E, dir, "/f.ttf", { scriptFlag: ["-/filter_complex"] });
  const g = require_graph(dir);
  assert.ok(a.includes("-/filter_complex")); assert.ok(a.includes("5.1")); assert.ok(a.includes("superfast"));
  assert.match(g, /textfile=.*text0-0\.txt:expansion=none/); assert.match(g, /text0-1\.txt/); assert.doesNotMatch(g, /text='/);
  assert.match(g, /blend=all_expr='A\*0\.500\+B\*0\.500'/); assert.match(g, /\[p0\]format=yuva420p/);
  assert.ok(a.join(" ").includes("-map 2:a"));
});
import { readFileSync } from "node:fs";
function require_graph(dir) { return readFileSync(`${dir}/graph.txt`, "utf8"); }
