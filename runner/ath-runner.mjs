#!/usr/bin/env node
// ATH RUNNER · the GitHub Actions lane of the ONE ath_ops queue (2026-11-12). Pull-only, $0, runs with every Mac off.
// It holds NO stored secret: each call to the queue gate (Supabase Edge Function `ath-runner`) carries this run's
// short-lived GitHub OIDC token, which the gate verifies (repo + branch + workflow pinned).
// Job kinds are fixed templates. Payload values are validated and only ever passed as single arguments or text files
// (no shell, no model-written commands, no arbitrary URLs: page captures are limited to ATH hosts; files come only
// from the job's own storage paths through the gate's signed URLs).
//   node runner/ath-runner.mjs --peek            heartbeat; writes waiting=<n> to $GITHUB_OUTPUT
//   node runner/ath-runner.mjs --work [--minutes 12]   claim -> run -> upload -> finish, until empty or time is up
//   node runner/ath-runner.mjs --local <kind> <payload.json> <outdir>   run one handler offline (no queue, no upload)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, cpSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeStudiosRender } from "./studios-render.mjs";

const GATE = "https://zrzaifaxecwgpfrqctkp.supabase.co/functions/v1/ath-runner";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT = process.env.ATH_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const CHROME = process.env.ATH_CHROME || "google-chrome";
const PIPER_DIR = process.env.PIPER_DIR || join(process.env.HOME || "/tmp", ".piper");
const ATH_HOSTS = new Set(["spaidbot.cloud", "abovethehilldev.online", "www.abovethehilldev.online", "thewow.online", "www.thewow.online",
  "wavemotion.live", "www.wavemotion.live", "wealthymindsetspro.com", "www.wealthymindsetspro.com", "powertribes.cloud", "wowstudios.cloud"]);
const DEVICES = { phone: [390, 844], desktop: [1440, 900] };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- process + tools -------------------------------------------------------------------------------------------
function run(cmd, args, { input, timeoutMs = 300000, cwd } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => { if (out.length < 4e6) out += d; });
    p.stderr.on("data", (d) => { if (err.length < 4e6) err += d; });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}
async function must(cmd, args, opts) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${r.code == null ? "timed out or was killed" : "failed"} (${r.code}) [${String(args.find((a) => /\.(py|mjs)$/.test(a)) || args[0] || "").split("/").pop()} ${args[1] && !/^-/.test(args[1]) ? args[1] : ""}]: ${r.err.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`);
  return r;
}
const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
async function probe(f) {
  const r = await must("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", f]);
  const j = JSON.parse(r.out);
  const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
  return { durationSeconds: Number(Number(j.format?.duration || 0).toFixed(3)), width: v?.width ?? null, height: v?.height ?? null,
    hasAudio: !!a, streams: j.streams.map((s) => [s.codec_type, s.codec_name, s.codec_type === "video" ? `${s.width}x${s.height}` : `${s.sample_rate}Hz/${s.channels}ch`].join(" ")) };
}
async function meanVolume(f) {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "volumedetect", "-vn", "-f", "null", "-"]);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.err);
  return m ? Number(m[1]) : null;
}

// ---------- validation ------------------------------------------------------------------------------------------------
const str = (v, max, name, { required = false, min = 0 } = {}) => {
  if (v == null || v === "") { if (required) throw new Error(`${name} is required`); return ""; }
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (s.length < min || s.length > max) throw new Error(`${name} must be ${min}-${max} characters`);
  return s;
};
const num = (v, lo, hi, def, name) => { if (v == null) return def; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be ${lo}-${hi}`); return n; };
const storagePath = (v, name, exts) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^(in\/[A-Za-z0-9._\/-]{1,180}|out\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80})$/.test(v) || v.includes("..")) throw new Error(`${name} must be a storage path (in/... or out/<job>/...)`);
  if (exts && !exts.some((e) => v.toLowerCase().endsWith(e))) throw new Error(`${name} must end with ${exts.join(" / ")}`);
  return v;
};
function athUrl(v) {
  let u; try { u = new URL(String(v)); } catch { throw new Error("url must be a full https address"); }
  if (u.protocol !== "https:" || !ATH_HOSTS.has(u.hostname) || u.username || u.password || u.port) throw new Error(`url must be an https page on an ATH host (${[...ATH_HOSTS].join(", ")})`);
  return u.toString();
}

// ---------- voice (free, local to the runner): Piper neural TTS, espeak-ng fallback ----------------------------------
async function speak(text, wav) {
  const model = "en_US-lessac-medium";
  const r = await run("python3", ["-m", "piper", "-m", join(PIPER_DIR, model + ".onnx"), "-f", wav], { input: text, timeoutMs: 120000 });
  if (r.code !== 0) log("piper unavailable:", r.err.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 160));
  if (r.code === 0 && existsSync(wav) && statSync(wav).size > 2000) return { engine: "piper", model };
  const e = await run("espeak-ng", ["-v", "en-us", "-s", "160", "-w", wav, "-f", "/dev/stdin"], { input: text, timeoutMs: 60000 });
  if (e.code === 0 && existsSync(wav) && statSync(wav).size > 2000) return { engine: "espeak-ng", model: "en-us" };
  if (process.platform === "darwin") { // local Mac test only
    const aiff = wav.replace(/\.wav$/, ".aiff"); const m = await run("say", ["-o", aiff, "-f", "-"], { input: text });
    if (m.code === 0) { await must("ffmpeg", ["-y", "-v", "error", "-i", aiff, wav]); return { engine: "macos-say", model: "default" }; }
  }
  throw new Error("no voice engine produced audio (piper and espeak-ng both failed)");
}

// ---------- media.render ----------------------------------------------------------------------------------------------
function textCards(dir, lines, W, H, seconds, brand, lower = false, endCard = 0) {
  // Each line gets its own time window; text goes through files (no escaping, expansion off).
  // endCard > 0: the last endCard seconds are a brand end card (lines stop before it).
  const linesEnd = seconds - endCard;
  const f = [], size = Math.round(W * (W < H ? 0.062 : 0.045)), slot = linesEnd / Math.max(1, lines.length);
  lines.forEach((line, i) => {
    const file = join(dir, `line${i}.txt`); writeFileSync(file, wrap(line, W < H ? 22 : 36));
    const a = (i * slot).toFixed(2), b = ((i + 1) * slot - 0.15).toFixed(2);
    f.push(`drawtext=fontfile=${FONT}:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=0xF4EBD0:line_spacing=${Math.round(size * 0.3)}` +
      `:x=(w-text_w)/2:y=${lower ? `h*0.80-text_h/2:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.45)}` : "(h-text_h)/2"}:shadowcolor=black@0.7:shadowx=3:shadowy=3:enable='between(t,${a},${b})'` +
      `:alpha='if(lt(t,${a}+0.35),(t-${a})/0.35,1)'`);
  });
  if (brand) { const file = join(dir, "brand.txt"); writeFileSync(file, brand);
    const e = linesEnd.toFixed(2);
    f.push(`drawtext=fontfile=${FONT}:textfile=${file}:expansion=none:fontsize=${Math.round(size * 0.55)}:fontcolor=0xD4AF37:x=(w-text_w)/2:y=h-text_h-${Math.round(H * 0.07)}` +
      (endCard ? `:enable='lt(t,${e})'` : ""));
    if (endCard) f.push(`drawtext=fontfile=${FONT}:textfile=${file}:expansion=none:fontsize=${Math.round(size * 1.15)}:fontcolor=0xD4AF37` +
      `:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.7:shadowx=3:shadowy=3:enable='gte(t,${e})':alpha='if(lt(t,${e}+0.3),(t-${e})/0.3,1)'`); }
  return f;
}
function wrap(s, n) { const out = []; let cur = ""; for (const w of s.split(/\s+/)) { if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) out.push(cur); return out.join("\n"); }

async function mediaRender(p, io) {
  if (p.format === "spot") return mediaSpot(p, io);
  const format = p.format === "clip" ? "clip" : "commercial";
  const aspect = p.aspect === "16:9" ? "16:9" : "9:16";
  const [W, H] = aspect === "9:16" ? [1080, 1920] : [1280, 720];
  const voiceText = str(p.voice, 400, "voice", { required: format === "commercial", min: format === "commercial" ? 8 : 0 });
  const lines = (Array.isArray(p.lines) ? p.lines : []).slice(0, 4).map((l, i) => str(l, 70, `lines[${i}]`)).filter(Boolean);
  const brand = str(p.brand ?? (format === "commercial" ? "Above The Hill" : ""), 40, "brand");
  const dir = io.dir, out = join(dir, `${format}.mp4`);
  // Commercial: length follows the voice (voice + 1 s brand end card, 6..15 s) so there is never a silent tail.
  const END_CARD = 1, MAX_C = 15, MIN_C = 6;
  let seconds = format === "commercial" ? MAX_C : num(p.duration, 3, 60, 15, "duration");
  let voice = null, voiceWav = null;
  if (voiceText) {
    voiceWav = join(dir, "voice.wav"); voice = await speak(voiceText, voiceWav);
    voice.seconds = (await probe(voiceWav)).durationSeconds;
    const room = format === "commercial" ? MAX_C - END_CARD : seconds - 0.3;
    if (voice.seconds > room) {
      const tempo = voice.seconds / (room - 0.2);
      if (tempo > 1.3) throw new Error(`voice script runs ${voice.seconds}s; it must fit in ${seconds}s (shorten it)`);
      const fast = join(dir, "voice-fit.wav"); await must("ffmpeg", ["-y", "-v", "error", "-i", voiceWav, "-af", `atempo=${tempo.toFixed(3)}`, fast]);
      voiceWav = fast; voice.tempo = Number(tempo.toFixed(3)); voice.seconds = (await probe(fast)).durationSeconds;
    }
  }
  if (format === "commercial") seconds = Math.min(MAX_C, Math.max(MIN_C, Math.ceil((voice.seconds + 0.25 + END_CARD) * 10) / 10));
  const endCard = format === "commercial" && brand ? END_CARD : 0;
  const cards = textCards(dir, lines, W, H, seconds, brand, format === "clip", endCard);
  const args = ["-y", "-v", "error"];
  let vf, srcAudio = false;
  if (format === "commercial") {
    const bg = storagePath(p.background, "background", [".png", ".jpg", ".jpeg", ".webp"]);
    if (bg) {
      const f = join(dir, "bg" + bg.slice(bg.lastIndexOf("."))); await io.fetchInput(bg, f);
      args.push("-loop", "1", "-framerate", "30", "-t", String(seconds), "-i", f);
      const SW = Math.round(W * 0.56) * 2, SH = Math.round(H * 0.56) * 2;
      vf = `[0:v]scale=${SW}:${SH}:force_original_aspect_ratio=increase,crop=${SW}:${SH},` +
        `zoompan=z='min(zoom+0.0006,1.10)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,eq=brightness=-0.12,`;
    } else {
      args.push("-f", "lavfi", "-t", String(seconds), "-i", `color=c=0x0b0d10:s=${W}x${H}:r=30`);
      vf = `[0:v]drawbox=x=0:y=ih*0.18:w=iw:h=4:color=0xD4AF37@0.9:t=fill,drawbox=x=0:y=ih*0.82:w=iw:h=4:color=0xD4AF37@0.9:t=fill,vignette,`;
    }
  } else {
    const src = storagePath(p.source, "source", [".mp4", ".mov", ".m4v", ".webm"]);
    if (!src) throw new Error("clip needs source (a storage path to a video)");
    const f = join(dir, "source" + src.slice(src.lastIndexOf("."))); await io.fetchInput(src, f);
    const info = await probe(f); srcAudio = info.hasAudio;
    const start = num(p.start, 0, Math.max(0, info.durationSeconds - 1), 0, "start");
    args.push("-ss", String(start), "-t", String(seconds), "-i", f);
    vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,`;
  }
  vf += (cards.length ? cards.join(",") : "null") + ",format=yuv420p[v]";
  let af;
  if (voiceWav) {
    args.push("-i", voiceWav);
    const vi = 1;
    af = srcAudio ? `[0:a]volume=0.25[bed];[${vi}:a]apad[vo];[bed][vo]amix=inputs=2:duration=first:normalize=0,atrim=0:${seconds}[a]`
      : `[${vi}:a]loudnorm=I=-16:TP=-1.5,apad,atrim=0:${seconds}[a]`;
  } else if (srcAudio) af = `[0:a]atrim=0:${seconds}[a]`;
  else { args.push("-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo"); af = `[1:a]anull[a]`; }
  args.push("-filter_complex", vf + ";" + af, "-map", "[v]", "-map", "[a]", "-t", String(seconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out);
  await must("ffmpeg", args, { timeoutMs: 600000 });
  const poster = join(dir, "poster.png");
  await must("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(2, seconds / 3)), "-i", out, "-frames:v", "1", poster]);
  const info = await probe(out), mean = await meanVolume(out);
  if (Math.abs(info.durationSeconds - seconds) > 0.6) throw new Error(`render is ${info.durationSeconds}s, expected ${seconds}s`);
  if (voiceWav && (mean == null || mean < -45)) throw new Error(`voice not audible in the render (mean ${mean} dB)`);
  let silentTail = null;
  if (format === "commercial") {
    silentTail = Number(Math.max(0, info.durationSeconds - voice.seconds).toFixed(2));
    if (silentTail > END_CARD + 0.6) throw new Error(`commercial has ${silentTail}s after the voice ends (max ${END_CARD + 0.6}s)`);
  }
  const outputs = [await io.store(out, `${format}.mp4`), await io.store(poster, "poster.png")];
  return { format, aspect, title: lines[0] || null, ...info, meanVolumeDb: mean, voiceBakedIn: !!voiceWav && info.hasAudio, voice, afterVoiceSeconds: silentTail, endCardSeconds: endCard || null, outputs,
    note: voice?.engine === "espeak-ng" ? "voice used the espeak-ng fallback (robotic); Piper was unavailable on this run" : null };
}

// ---------- media.render format "spot": the graded ATH commercials v3 (apartment walkthrough) -------------------------
// Port of the Mac kit (~/ath-canon-live/shift-1112/commercials-kit build3/spots3/qa3) so renders stop using the Mac.
// Payload: {format:"spot", spot:"hook1", aspect:"9:16"|"16:9", source:"in/commercials/kit-v3.zip"}
// The kit zip (Flow room stills + door clip, Dspaid's songs) is private: it lives in the ath-worker bucket and is fetched
// through the gate's signed URL; nothing private is in this public repo. App footage is captured live, here, headless.
const KIT = join(ROOT, "runner", "commercial");
const KOKORO_DIR = process.env.KOKORO_DIR || join(process.env.HOME || "/tmp", ".kokoro");
async function py(args, timeoutMs = 300000) { return JSON.parse((await must("python3", [...args], { timeoutMs })).out.trim().split("\n").pop()); }
async function mediaSpot(p, io) {
  const names = await py([join(KIT, "build.py"), "list"]);
  const spot = typeof p.spot === "string" && names.includes(p.spot) ? p.spot : null;
  if (!spot) throw new Error(`spot must be one of ${names.join(", ")}`);
  const o = p.aspect === "16:9" ? "h" : "v";
  const kitPath = storagePath(p.source, "source", [".zip"]);
  if (!kitPath) throw new Error("spot needs source (the private kit zip, e.g. in/commercials/kit-v3.zip)");
  const t0 = Date.now(), lap = {}; const mark = (k) => { lap[k] = Number(((Date.now() - t0) / 1000).toFixed(1)); log(`spot ${spot}-${o}: ${k} done at ${lap[k]}s`); };
  const dir = io.dir, kit = join(dir, "kit"), raw = join(dir, "raw"), np = join(dir, "raw-np"), work = join(dir, "work");
  for (const d of [kit, raw, np, work]) mkdirSync(d, { recursive: true });
  await io.fetchInput(kitPath, join(dir, "kit.zip"));
  await must("unzip", ["-q", "-o", join(dir, "kit.zip"), "-d", kit]); mark("kit");
  const clips = await py([join(KIT, "build.py"), "clips", spot, o]);
  const { captureClips } = await import("./commercial/capture.mjs");
  const captured = await captureClips(clips, raw, CHROME); mark("capture");
  const blurred = {};
  for (const c of clips) blurred[c] = await py([join(KIT, "priceguard.py"), "blur", join(raw, c + ".mp4"), join(np, c + ".mp4")], 240000);
  mark("priceblur");
  const out = join(dir, `${spot}-${o === "v" ? "9x16" : "16x9"}.mp4`);
  const built = await py([join(KIT, "build.py"), "build", spot, o, "--kit", kit, "--raw", np, "--work", work, "--out", out, "--models", KOKORO_DIR], 480000);
  mark("render");
  const qa = await py([join(KIT, "qa.py"), out, built.file + (o === "v" ? "-9x16" : "-16x9")]); mark("qa");
  if (qa.price.priceFrames > 0) throw new Error(`value first: OCR found price text in ${qa.price.priceFrames} frame(s): ${qa.price.samples.join(" / ")}`);
  const poster = join(dir, "poster.png");
  await must("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(3, qa.seconds / 3)), "-i", out, "-frames:v", "1", poster]);
  const qaFile = join(dir, "qa.json"); writeFileSync(qaFile, JSON.stringify({ spot, ...built, qa, captured, blurred }, null, 2));
  const info = await probe(out);
  const outputs = [await io.store(out, `${spot}-${o === "v" ? "9x16" : "16x9"}.mp4`), await io.store(poster, "poster.png"), await io.store(qaFile, "qa.json")];
  return { format: "spot", ...built, ...info, grade: qa.pass ? "PASS" : "CHECK: " + Object.entries(qa.checks).filter(([, v]) => !v).map(([k]) => k).join(", "),
    qa, footage: captured.map((c) => ({ clip: c.clip, url: c.url })), priceBlur: Object.fromEntries(Object.entries(blurred).map(([k, v]) => [k, v.boxes])), seconds: lap, outputs,
    note: "AI voice (Kokoro) + AI room imagery (Google Flow), labelled on the end card; every screen is the real live app captured in this run" };
}

// ---------- visual.compare (Visual Twin) ------------------------------------------------------------------------------
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
async function capture(url, W, H, file, waitMs = 3000) {
  // Real viewport emulation (a bare --window-size screenshot lays phones out wider than 390).
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--no-first-run"] });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e?.message || e).slice(0, 200)));
    const phone = W < 600;
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
    if (phone) await page.setUserAgent(MOBILE_UA);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => { if (!/timeout/i.test(String(e?.message))) throw e; });
    await new Promise((r) => setTimeout(r, waitMs));
    await page.screenshot({ path: file, type: "png" });
    return { consoleErrors: consoleErrors.slice(0, 5) };
  } finally { await browser.close(); }
}
async function visualCompare(p, io) {
  const device = p.device === "desktop" ? "desktop" : "phone";
  const [W, H] = DEVICES[device];
  const threshold = num(p.threshold, 0.5, 0.999, 0.9, "threshold");
  const dir = io.dir, live = join(dir, "live.png");
  let url = null;
  const livePath = storagePath(p.live, "live", [".png", ".jpg", ".jpeg", ".webp"]);
  if (livePath) await io.fetchInput(livePath, live);
  else { url = athUrl(p.url); await capture(url, W, H, live); }
  const ref = storagePath(p.reference, "reference", [".png", ".jpg", ".jpeg", ".webp"]);
  const outputs = [await io.store(live, "live.png")];
  const L = await probe(live);
  if (!ref) return { url, device, width: L.width, height: L.height, score: null, pass: null, threshold, outputs, note: "baseline captured (no reference yet): the next run of this page compares against it" };
  const refFile = join(dir, "reference" + ref.slice(ref.lastIndexOf("."))); await io.fetchInput(ref, refFile);
  const R = await probe(refFile);
  if (R.width !== L.width || R.height !== L.height) throw new Error(`reference is ${R.width}x${R.height} but the live capture is ${L.width}x${L.height}; capture both at the same size`);
  const s = await must("ffmpeg", ["-hide_banner", "-i", live, "-i", refFile, "-lavfi", "[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]ssim", "-f", "null", "-"]);
  const m = /All:([\d.]+)/.exec(s.err); if (!m) throw new Error("SSIM not measured");
  const score = Number(Number(m[1]).toFixed(4));
  const diff = join(dir, "diff.png");
  await must("ffmpeg", ["-y", "-v", "error", "-i", live, "-i", refFile, "-filter_complex", "[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]blend=all_mode=difference,eq=contrast=3:brightness=0.05", "-frames:v", "1", diff]);
  outputs.push(await io.store(diff, "diff.png"));
  return { url, device, width: L.width, height: L.height, reference: ref, score, threshold, pass: score >= threshold, outputs,
    note: "SSIM measures pixels only; a person still judges hierarchy, type and interaction" };
}

// ---------- game.build ------------------------------------------------------------------------------------------------
const TEMPLATES = { catch: "Catch the falling stars", dodge: "Dodge the falling blocks" };
async function gameBuild(p, io) {
  const template = Object.hasOwn(TEMPLATES, p.template) ? p.template : null;
  if (!template) throw new Error(`template must be one of ${Object.keys(TEMPLATES).join(", ")}`);
  const title = str(p.title, 40, "title") || TEMPLATES[template];
  const color = typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#D4AF37";
  const speed = num(p.speed, 1, 3, 2, "speed");
  const build = join(io.dir, "game"); cpSync(join(ROOT, "games", template), build, { recursive: true });
  const cfg = JSON.stringify({ title, color, speed, template }).replace(/</g, "\\u003c");
  const html = readFileSync(join(build, "index.html"), "utf8");
  if (!html.includes("/*ATH_CONFIG*/{}")) throw new Error("template is missing its config slot");
  writeFileSync(join(build, "index.html"), html.replace("/*ATH_CONFIG*/{}", cfg));
  // Smoke test: the game must paint, start itself in demo mode, and throw no uncaught errors.
  const shot = join(io.dir, "play.png");
  const { consoleErrors } = await capture("file://" + join(build, "index.html") + "?demo=1", 390, 844, shot, 4000);
  const st = await run("ffmpeg", ["-hide_banner", "-i", shot, "-vf", "format=gray,signalstats,metadata=print", "-f", "null", "-"]);
  const ymin = Number((/signalstats\.YMIN=(\d+)/.exec(st.err) || [])[1]), ymax = Number((/signalstats\.YMAX=(\d+)/.exec(st.err) || [])[1]);
  const nonBlank = Number.isFinite(ymin) && Number.isFinite(ymax) && ymax - ymin > 40;
  if (!nonBlank) throw new Error("smoke test: the game screen is blank");
  if (consoleErrors.length) throw new Error("smoke test: " + consoleErrors.join(" | ").slice(0, 300));
  const zip = join(io.dir, "game.zip");
  await must("zip", ["-q", "-r", zip, "."], { cwd: build });
  const outputs = [await io.store(zip, "game.zip"), await io.store(shot, "play.png")];
  return { template, title, color, speed, smoke: { nonBlank, yRange: [ymin, ymax], consoleErrors: 0, device: "phone 390x844" }, outputs,
    note: "playable HTML5 game: unzip and open index.html (touch or arrow keys)" };
}

const studiosRender = makeStudiosRender({ must, probe, sha256, storagePath, font: FONT, run });
const HANDLERS = { "media.render": mediaRender, "visual.compare": visualCompare, "game.build": gameBuild, "studios.render": studiosRender };
// The named ATHOS assistants (Founder 2026-11-12: "each worker gets its own name and job"); same names as Spaidbot's
// spaidbot/sb-athos-team.mjs. Stamped on every result so receipts say who did the work.
export const ASSISTANT = (kind, p = {}) => kind === "media.render" ? (p.format === "clip" ? "ATHOS · Reel" : "ATHOS · Herald") : kind === "visual.compare" ? "ATHOS · Lens" : kind === "game.build" ? "ATHOS · Forge" : kind === "studios.render" ? "ATHOS · Studios" : "ATHOS";

// ---------- queue gate ------------------------------------------------------------------------------------------------
let tok = null, tokAt = 0;
async function oidc() {
  if (tok && Date.now() - tokAt < 4 * 60000) return tok;
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no GitHub OIDC token (workflow needs permissions: id-token: write)");
  const r = await fetch(u + "&audience=ath-runner", { headers: { authorization: "Bearer " + t } });
  if (!r.ok) throw new Error("OIDC request failed " + r.status);
  tok = (await r.json()).value; tokAt = Date.now(); return tok;
}
async function gate(op, body = {}) {
  const r = await fetch(GATE, { method: "POST", headers: { authorization: "Bearer " + (await oidc()), "content-type": "application/json" }, body: JSON.stringify({ op, ...body }), signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`gate ${op} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
function ioFor(job, dir) {
  return {
    dir,
    async fetchInput(path, file) {
      const { url } = await gate("input", { id: job.id, path });
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`input ${path} ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 200 * 1024 * 1024) throw new Error("input over 200 MB");
      writeFileSync(file, buf);
    },
    async store(file, name) {
      const size = statSync(file).size; if (size > 50 * 1024 * 1024) throw new Error(`${name} is over the 50 MB storage limit`);
      const { url, path, type } = await gate("upload", { id: job.id, name });
      const r = await fetch(url, { method: "PUT", headers: { "content-type": type, "x-upsert": "true" }, body: readFileSync(file), signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`upload ${name} ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return { path, type, bytes: size, sha256: sha256(file) };
    },
  };
}

async function work(minutes) {
  const until = Date.now() + minutes * 60000;
  let done = 0;
  while (Date.now() < until - 90000) {
    await gate("heartbeat");
    const job = await gate("claim");
    if (!job || job.paused || job.capped) { log(job?.paused ? "paused by the Founder switch" : job?.capped ? "daily job cap reached" : "queue empty"); break; }
    const who = ASSISTANT(job.kind, job.payload || {});
    log(`${who} claimed ${job.kind} ${job.id} (try ${job.attempts})`);
    const dir = mkdtempSync(join(tmpdir(), "job-"));
    let ok = false, result = null, error = null;
    try { result = { assistant: who, ...(await HANDLERS[job.kind](job.payload || {}, ioFor(job, dir))) }; ok = true; }
    catch (e) { error = String(e?.message || e).slice(0, 900); }
    const fin = await gate("finish", { id: job.id, ok, result, error });
    log(`${who} · ${job.kind} ${job.id} -> ${fin ? fin.status : "LATE (lease lost; finish refused)"}${error ? " · " + error : ""}`);
    if (ok) log("outputs:", (result.outputs || []).map((o) => `${o.path} ${o.bytes}B sha256=${o.sha256.slice(0, 12)}`).join(" , "));
    done++;
  }
  return done;
}

const argv = process.argv.slice(2);
if (argv[0] === "--peek") {
  const hb = await gate("heartbeat");
  log(`runner checked in · waiting=${hb.waiting} · away_mode=${hb.away_mode}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `waiting=${hb.away_mode ? hb.waiting : 0}\n`);
} else if (argv[0] === "--work") {
  const i = argv.indexOf("--minutes"), m = i > 0 ? Number(argv[i + 1]) : 12;
  const n = await work(Number.isFinite(m) ? Math.min(Math.max(m, 3), 25) : 12);
  log(`finished ${n} job(s)`);
} else if (argv[0] === "--local") {
  const [, kind, payloadFile, outDir] = argv;
  mkdirSync(outDir, { recursive: true });
  const io = { dir: outDir, async fetchInput(path, file) { cpSync(join(outDir, "inputs", path), file); },
    async store(file, name) { return { path: "local/" + name, bytes: statSync(file).size, sha256: sha256(file) }; } };
  console.log(JSON.stringify(await HANDLERS[kind](JSON.parse(readFileSync(payloadFile, "utf8")), io), null, 2));
} else { console.error("usage: --peek | --work [--minutes n] | --local <kind> <payload.json> <outdir>"); process.exit(2); }
