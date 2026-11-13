// studios.render — WOW Studios "The Cut" export at sizes the browser cannot encode (up to 4K UHD), on the runner.
// The browser sends ONE bundle (an uncompressed .zip it wrote itself): edl.json + the clips' media + LUT .cube files +
// mix.wav (the edit's sound, already mixed in the browser by the same engine as a local export, so sound is identical).
// The runner validates every number in edl.json, builds the ffmpeg graph itself (no strings from the payload reach a
// filter except through files), renders H.264 High, and stores the MP4 in parts of at most 45 MB (the storage object
// limit is 50 MB); the browser joins the parts and checks the whole file's SHA-256.
import { join } from "node:path";
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";

// Work budget per job: 60 s of 4K at 30 fps (the runner's 14-minute window, ~3 fps at 4K). Smaller sizes get longer.
export const PIXEL_FRAMES = 3840 * 2160 * 1800;
export const MAX_SECONDS = 180, MAX_LAYERS = 160, MAX_TEXTS = 200, PART_BYTES = 45 * 1024 * 1024;
const SIZES = new Set(["1280x720", "720x1280", "1920x1080", "1080x1920", "2560x1440", "1440x2560", "3840x2160", "2160x3840", "1080x1080", "1440x1440", "2160x2160", "1080x1350", "1728x2160"]);
const NAME = /^[a-z0-9][a-z0-9._-]{0,47}$/;

// ---------- the bundle: an uncompressed (stored) zip ----------
export function readZip(buf) {
  const out = new Map(); let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nlen), at = i + 30 + nlen + xlen;
    if (method !== 0) throw new Error(`bundle entry ${name} is compressed; the Studios bundle must be stored`);
    if (!NAME.test(name)) throw new Error(`bundle entry name not allowed: ${name.slice(0, 60)}`);
    if (at + size > buf.length) throw new Error("bundle is truncated");
    out.set(name, buf.subarray(at, at + size)); i = at + size;
  }
  if (!out.size) throw new Error("bundle has no files");
  return out;
}

// ---------- validation: every field is a number, an enum, a known file, or text that only ever goes into a file ----------
const n = (v, lo, hi, def, name) => { if (v == null) return def; const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${name} must be ${lo}..${hi}`); return x; };
const pick = (v, list, def) => (list.includes(v) ? v : def);
export function validateEdl(e, files) {
  if (!e || e.v !== 1) throw new Error("edl.json version must be 1");
  const size = `${e.w}x${e.h}`; if (!SIZES.has(size)) throw new Error(`output size ${size} is not offered`);
  const fps = pick(Number(e.fps), [24, 25, 30, 60], null); if (!fps) throw new Error("fps must be 24, 25, 30 or 60");
  const frames = Math.round(n(e.frames, 1, MAX_SECONDS * fps, 0, "frames"));
  if (e.w * e.h * frames > PIXEL_FRAMES) throw new Error(`too long for one cloud render at ${size}: at most ${Math.floor(PIXEL_FRAMES / (e.w * e.h) / fps)} s at ${fps} fps`);
  const media = new Map();
  for (const m of (e.media || []).slice(0, 80)) {
    if (!NAME.test(m.file || "") || !files.has(m.file)) throw new Error(`media file missing from the bundle: ${String(m.file).slice(0, 40)}`);
    media.set(String(m.id), { file: m.file, kind: pick(m.kind, ["video", "image"], "video") });
  }
  const luts = new Map();
  for (const l of (e.luts || []).slice(0, 20)) { if (!NAME.test(l.file || "") || !files.has(l.file) || !l.file.endsWith(".cube")) throw new Error("LUT file missing"); luts.set(String(l.id), l.file); }
  const layers = (e.layers || []).slice(0, MAX_LAYERS + 1); if (layers.length > MAX_LAYERS) throw new Error(`more than ${MAX_LAYERS} picture clips`);
  const L = layers.map((c, i) => {
    const m = media.get(String(c.media)); if (!m) throw new Error(`layer ${i}: unknown media`);
    const lut = c.lut && luts.get(String(c.lut.id)) ? { file: luts.get(String(c.lut.id)), mix: n(c.lut.mix, 0, 1, 1, "lut.mix") } : null;
    return { file: m.file, kind: m.kind, track: pick(c.track, ["V1", "V2"], "V1"), start: Math.round(n(c.start, 0, frames, 0, "start")), dur: Math.round(n(c.dur, 1, frames + 600, 1, "dur")),
      in: n(c.in, 0, 86400, 0, "in"), speed: n(c.speed, 0.1, 16, 1, "speed"), fit: pick(c.fit, ["cover", "contain"], "cover"), scale: n(c.scale, 0.05, 8, 1, "scale"),
      x: n(c.x, -4, 4, 0, "x"), y: n(c.y, -4, 4, 0, "y"), rotate: n(c.rotate, -360, 360, 0, "rotate"), opacity: n(c.opacity, 0, 1, 1, "opacity"),
      color: { b: n(c.color?.b, -100, 100, 0, "b"), c: n(c.color?.c, -100, 100, 0, "c"), s: n(c.color?.s, -100, 100, 0, "s"), w: n(c.color?.w, -100, 100, 0, "w") },
      lut, fadeIn: Math.round(n(c.fadeIn, 0, 600, 0, "fadeIn")), fadeOut: Math.round(n(c.fadeOut, 0, 600, 0, "fadeOut")) };
  });
  const texts = (e.texts || []).slice(0, MAX_TEXTS).map((t) => ({ kind: pick(t.kind, ["title", "caption"], "title"),
    text: String(t.text || "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, 600),
    start: Math.round(n(t.start, 0, frames, 0, "text.start")), dur: Math.round(n(t.dur, 1, frames, 1, "text.dur")),
    px: Math.round(n(t.px, 6, 1200, 60, "text.px")), cx: n(t.cx, -2, 3, 0.5, "text.cx"), cy: n(t.cy, -2, 3, 0.72, "text.cy"), box: !!t.box,
    opacity: n(t.opacity, 0, 1, 1, "text.opacity"), fadeIn: Math.round(n(t.fadeIn, 0, 600, 0, "text.fadeIn")), fadeOut: Math.round(n(t.fadeOut, 0, 600, 0, "text.fadeOut")) })).filter((t) => t.text.trim());
  const mix = e.mix && files.has(e.mix) && e.mix.endsWith(".wav") ? e.mix : null;
  return { w: e.w, h: e.h, fps, frames, layers: L, texts, mix, name: String(e.name || "cut").replace(/[^\w .-]+/g, "_").slice(0, 60) };
}

// ---------- the graph ----------
const f3 = (x) => Number(x).toFixed(3);
export function buildArgs(E, dir, font, { scriptFlag = ["-filter_complex_script"] } = {}) {
  const { w: W, h: H, fps, frames } = E, T = frames / fps;
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${fps}:d=${f3(T)}`];
  const chains = [];
  let last = "[0:v]", k = 1;
  // paint order: V1 clips by start, then V2 (the browser paints V1 then V2, then titles, then captions)
  const ordered = [...E.layers.filter((l) => l.track === "V1"), ...E.layers.filter((l) => l.track === "V2")];
  ordered.forEach((l, i) => {
    const T0 = l.start / fps, D = l.dur / fps;
    if (l.kind === "image") args.push("-loop", "1", "-framerate", String(fps), "-t", f3(D + 0.1), "-i", join(dir, l.file));
    else args.push("-ss", f3(l.in), "-t", f3(D * l.speed + 0.1), "-i", join(dir, l.file));
    const inV = `[${k}:v]`; k++;
    const g = [`setpts=(PTS-STARTPTS)/${f3(l.speed)}`, `fps=${fps}`];
    // the browser: base = cover ? max(W/sw, H/sh) : min(...); drawn size = source × base × scale, centred, never cropped to a box
    const m = l.fit === "cover" ? "max" : "min", s2 = f3(l.scale);
    g.push(`scale=w='trunc(iw*${m}(${W}/iw\\,${H}/ih)*${s2}/2)*2':h='trunc(ih*${m}(${W}/iw\\,${H}/ih)*${s2}/2)*2':flags=bicubic`);
    // CSS order: brightness() then contrast() (both exact per pixel), then saturate(), then the warmth wash (source-atop)
    const c = l.color, kb = 1 + c.b / 100, kc = 1 + c.c / 100;
    if (c.b || c.c) { const ex = `clip(((val*${f3(kb)})/255-0.5)*${f3(kc)}+0.5\\,0\\,1)*255`; g.push(`format=rgb24,lutrgb=r='${ex}':g='${ex}':b='${ex}'`); }
    if (c.s) g.push(`eq=saturation=${f3(1 + c.s / 100)}`);
    if (c.w) { const a2 = Math.abs(c.w) / 450, [R, G, B] = c.w > 0 ? [255, 150, 40] : [60, 130, 255];
      g.push(`format=rgb24,lutrgb=r='val*${f3(1 - a2)}+${f3(R * a2)}':g='val*${f3(1 - a2)}+${f3(G * a2)}':b='val*${f3(1 - a2)}+${f3(B * a2)}'`); }
    let src = `${inV}${g.join(",")}`;
    if (l.lut) {
      if (l.lut.mix >= 0.999) src += `,lut3d=file=${join(dir, l.lut.file)}`;
      else { chains.push(`${src},format=rgb24,split[g${i}a][g${i}b];[g${i}b]lut3d=file=${join(dir, l.lut.file)}[g${i}l];[g${i}a][g${i}l]blend=all_expr='A*${f3(1 - l.lut.mix)}+B*${f3(l.lut.mix)}'[p${i}]`); src = `[p${i}]`; }
    }
    const post = ["format=yuva420p"];
    if (l.rotate) { const r = f3(l.rotate * Math.PI / 180); post.push(`rotate=${r}:c=none:ow=rotw(${r}):oh=roth(${r})`); }
    if (l.opacity < 1) post.push(`colorchannelmixer=aa=${f3(l.opacity)}`);
    if (l.fadeIn) post.push(`fade=t=in:st=0:d=${f3(l.fadeIn / fps)}:alpha=1`);
    if (l.fadeOut) post.push(`fade=t=out:st=${f3(Math.max(0, D - l.fadeOut / fps))}:d=${f3(l.fadeOut / fps)}:alpha=1`);
    post.push(`setpts=PTS+${f3(T0)}/TB`);
    chains.push(`${src}${src.endsWith(`[p${i}]`) ? "" : ","}${post.join(",")}[v${i}]`); // after a label the chain starts fresh
    const ox = `(W-w)/2+${f3(l.x)}*W`, oy = `(H-h)/2+${f3(l.y)}*H`;
    chains.push(`${last}[v${i}]overlay=x='${ox}':y='${oy}':eof_action=pass:enable='between(n\\,${l.start}\\,${l.start + l.dur - 1})'[o${i}]`);
    last = `[o${i}]`;
  });
  // titles then captions, each through its own text file (expansion off: no % sequences, no escaping games)
  const sorted = [...E.texts.filter((t) => t.kind === "title"), ...E.texts.filter((t) => t.kind === "caption")];
  sorted.forEach((t, j) => {
    // one drawtext per line, centred on its own (as the browser does), line height 1.22 × size, each line its own box
    const lines = t.text.split("\n").filter((x) => x.trim()), lh = t.px * 1.22;
    const a = t.start / fps, b = (t.start + t.dur) / fps, fi = t.fadeIn / fps, fo = t.fadeOut / fps;
    const alpha = `${f3(t.opacity)}*min(1\\,${fi ? `(t-${f3(a)})/${f3(fi)}` : 1})*min(1\\,${fo ? `(${f3(b)}-t)/${f3(fo)}` : 1})`;
    const col = t.kind === "title" ? "0xF3DC94" : "white";
    lines.forEach((ln, li) => {
      const file = join(dir, `text${j}-${li}.txt`); writeFileSync(file, ln);
      const dy = f3((li - (lines.length - 1) / 2) * lh);
      chains.push(`${last}drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${t.px}:fontcolor=${col}` +
        `:x=${f3(t.cx)}*w-text_w/2:y=${f3(t.cy)}*h+${dy}-${f3(t.px * 0.5)}` +
        (t.box ? `:box=1:boxcolor=black@0.62:boxborderw=${Math.round(t.px * 0.3)}` : `:borderw=${Math.max(1, Math.round(t.px * 0.07))}:bordercolor=black@0.85`) +
        `:alpha='${alpha}':enable='between(t\\,${f3(a)}\\,${f3(b)})'[t${j}_${li}]`);
      last = `[t${j}_${li}]`;
    });
  });
  chains.push(`${last}format=yuv420p[vout]`);
  const fc = join(dir, "graph.txt"); writeFileSync(fc, chains.join(";\n"));
  args.push(...(E.mix ? ["-i", join(dir, E.mix)] : []));
  const audioIdx = E.mix ? k : null;
  args.push(...scriptFlag, fc, "-map", "[vout]");
  if (audioIdx != null) args.push("-map", `${audioIdx}:a`, "-c:a", "aac", "-b:a", "256k", "-ar", "48000");
  const big = W * H >= 3840 * 2160 * 0.9;
  args.push("-c:v", "libx264", "-preset", big ? "superfast" : "veryfast", "-crf", big ? "20" : "18", "-profile:v", "high", "-level:v", big && fps > 30 ? "5.2" : big ? "5.1" : "4.2",
    "-pix_fmt", "yuv420p", "-r", String(fps), "-t", f3(T), "-movflags", "+faststart", join(dir, "render.mp4"));
  return args;
}
export function wrap(s, w) { return s.split("\n").map((line) => { const out = []; let cur = ""; for (const word of line.split(/\s+/)) { if ((cur + " " + word).trim().length > w && cur) { out.push(cur); cur = word; } else cur = (cur + " " + word).trim(); } if (cur) out.push(cur); return out.join("\n"); }).join("\n"); }

// ---------- handler ----------
export function makeStudiosRender({ must, probe, sha256, storagePath, font, run }) {
  return async function studiosRender(p, io) {
    // the bundle arrives in 1–4 parts (source, reference, live, background), each ≤48 MB; joined in that order
    const keys = ["source", "reference", "live", "background"], inParts = [];
    for (const [i, k] of keys.entries()) {
      if (p[k] == null) break;
      const v = storagePath(p[k], k, [".zip"]);
      if (!v || !new RegExp(`^in/studios/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}/bundle\\.p${i}\\.zip$`).test(v)) throw new Error(`${k} must be part ${i} of a Studios bundle`);
      inParts.push(v);
    }
    if (!inParts.length) throw new Error("source must be a Studios bundle (in/studios/<passport>/<render>/bundle.p0.zip)");
    if (new Set(inParts.map((x) => x.split("/").slice(0, 4).join("/"))).size !== 1) throw new Error("bundle parts must come from one render folder");
    const dir = io.dir, zipFile = join(dir, "bundle.zip"), bufs = [];
    for (const [i, part] of inParts.entries()) { const f = join(dir, `bundle.p${i}.zip`); await io.fetchInput(part, f); bufs.push(readFileSync(f)); }
    writeFileSync(zipFile, Buffer.concat(bufs));
    const files = readZip(readFileSync(zipFile));
    for (const [name, buf] of files) writeFileSync(join(dir, name), buf);
    if (!files.has("edl.json")) throw new Error("bundle has no edl.json");
    const E = validateEdl(JSON.parse(files.get("edl.json").toString("utf8")), files);
    // ffmpeg ≥ 7 reads a filter graph from a file with "-/filter_complex"; 6.x (Ubuntu 24.04) with "-filter_complex_script"
    const ver = Number((/ffmpeg version n?(\d+)/.exec((await run("ffmpeg", ["-version"])).out) || [])[1] || 6);
    const t0 = Date.now();
    await must("ffmpeg", buildArgs(E, dir, font, { scriptFlag: ver >= 7 ? ["-/filter_complex"] : ["-filter_complex_script"] }), { timeoutMs: 12 * 60000 });
    const renderSeconds = Math.round((Date.now() - t0) / 1000);
    const out = join(dir, "render.mp4"), info = await probe(out), whole = sha256(out), bytes = statSync(out).size;
    // parts of ≤45 MB, named render-p000.mp4… (the browser joins them in order and checks `sha256`)
    const parts = [], fd = openSync(out, "r");
    try {
      for (let off = 0, i = 0; off < bytes; off += PART_BYTES, i++) {
        const len = Math.min(PART_BYTES, bytes - off), b = Buffer.alloc(len); readSync(fd, b, 0, len, off);
        const pf = join(dir, `render-p${String(i).padStart(3, "0")}.mp4`); writeFileSync(pf, b);
        parts.push(await io.store(pf, `render-p${String(i).padStart(3, "0")}.mp4`));
      }
    } finally { closeSync(fd); }
    return { output: parts[0]?.path, parts, sha256: whole, sizeBytes: bytes, width: info.width, height: info.height, durationSeconds: info.durationSeconds, hasAudio: info.hasAudio,
      streams: info.streams, fps: E.fps, renderSeconds, layers: E.layers.length, texts: E.texts.length, name: E.name,
      note: "Picture rendered on the runner with ffmpeg from the edit list; sound is the browser's own mix of the edit." };
  };
}
