// Real live-app footage for the ATH commercials, captured headless IN THE RUNNER (puppeteer-core + the runner's Chrome).
// Port of the Mac kit capture.mjs (Playwright). Fixed public ATH pages only: the job payload names a spot, never a URL.
// usage (module): await captureClips(["wavsites-h", "wowtv-v"], outDir, chromePath)  -> [{clip, seconds, bytes}]
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

const W = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (dur, to) => `new Promise(r=>{const c=[...document.querySelectorAll('*')].filter(e=>{const st=getComputedStyle(e);return /(auto|scroll)/.test(st.overflowY)&&e.scrollHeight>e.clientHeight+50}).sort((a,b)=>b.clientHeight-a.clientHeight)[0];const el=(c&&document.scrollingElement.scrollHeight<=innerHeight+10)?c:document.scrollingElement;const s=el.scrollTop,e=Math.min((${to})===null?1e9:(${to}),el.scrollHeight-el.clientHeight),t0=performance.now();(function f(n){const k=Math.min((n-t0)/${dur},1);el.scrollTop=s+(e-s)*(1-Math.cos(Math.PI*k))/2;k<1?requestAnimationFrame(f):r()})(t0)})`;
const scroll = (pg, dur, to) => pg.evaluate(ease(dur, to));
const clickText = (pg, t, sel = "a,button") => pg.evaluate((t, sel) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && e.textContent.includes(t));
  if (el) el.click(); return !!el;
}, t, sel).catch(() => false);
const CHART_ON = encodeURIComponent("LivingProfile,BrickWalls,fp:big-trades,absorptionAnatomy,fvg");

export const SHOTS = {
  wowtv: { url: "https://thewow.online/wow-tv?ch=201", run: async (pg) => { await W(6000); await scroll(pg, 5000, "innerHeight*0.9"); await W(2500); await scroll(pg, 3000, 0); await W(2000); } },
  creators: { url: "https://thewow.online/creators", run: async (pg) => { await W(3500); await scroll(pg, 9000, "innerHeight*2.4"); await W(1500); } },
  wavsites: { url: "https://wavemotion.live/sites", run: async (pg) => { await W(3500); await scroll(pg, 12000, "innerHeight*4"); await W(1000); } },
  showstage: { url: "https://wavemotion.live/d/showcase-stage", run: async (pg) => { await W(3000); await scroll(pg, 7000, "innerHeight*2"); } },
  showstudio: { url: "https://wavemotion.live/d/showcase-studio", run: async (pg) => { await W(3000); await scroll(pg, 7000, "innerHeight*2"); } },
  showbiz: { url: "https://wavemotion.live/d/showcase-business", run: async (pg) => { await W(3000); await scroll(pg, 7000, "innerHeight*2"); } },
  showatmo: { url: "https://wavemotion.live/d/showcase-atmosphere", run: async (pg) => { await W(3000); await scroll(pg, 7000, "innerHeight*2"); } },
  pt: { url: "https://powertribes.cloud", run: async (pg) => {
    await W(4000); await clickText(pg, "Enter the tower"); await W(3500); await clickText(pg, "Call the elevator"); await W(3000);
    await clickText(pg, "Sales Floor"); await W(5500); await scroll(pg, 3500, "innerHeight*1.1"); await W(1000);
    await clickText(pg, "Elevator"); await W(2500); await clickText(pg, "Call the elevator"); await W(1500); await clickText(pg, "AI Workforce Command"); await W(5500); await scroll(pg, 3000, "innerHeight*0.9"); await W(800); } },
  studios: { url: "https://wowstudios.cloud", run: async (pg) => {
    await W(4000); await scroll(pg, 5000, "innerHeight*1.5"); await W(800);
    for (const h of ["#suite", "#session", "#mix"]) { await pg.evaluate((h) => { location.hash = h; }, h); await W(h === "#mix" ? 4000 : 5000); } } },
  spaidbot: { url: "https://spaidbot.cloud", run: async (pg) => { await W(4000); await scroll(pg, 10000, "innerHeight*3"); await W(1000); } },
  passport: { url: "https://thewow.online/passport", run: async (pg) => { await W(3500); await scroll(pg, 9000, null); await W(1500); } },
  // Public chart view; the client-side profile check is answered with a placeholder visual-probe identity (no credentials exist or are sent).
  wmcharts: { url: `https://wealthymindsetspro.com/charts?symbol=BTC-USD&tf=1m&scene=clean&on=${CHART_ON}`, stub: true, warm: 45000, run: async () => { await W(26000); } },
  wmcharts5: { url: `https://wealthymindsetspro.com/charts?symbol=BTC-USD&tf=5m&scene=clean&on=${CHART_ON}`, stub: true, warm: 45000, run: async () => { await W(20000); } },
  athhome: { url: "https://abovethehilldev.online/", run: async (pg) => { await W(4000); await scroll(pg, 9000, "innerHeight*2.5"); } },
  wowhome: { url: "https://thewow.online/", run: async (pg) => { await W(4000); await scroll(pg, 8000, "innerHeight*2"); } },
};
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PROBE_ME = JSON.stringify({ user: { id: "visual-probe", email: "visual@probe.local", displayName: "Visual", handle: "visual", profileComplete: true } });

export async function captureClips(clips, outDir, chrome, parallel = 3) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ["--no-sandbox", "--hide-scrollbars", "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
  const done = [];
  const one = async (clip) => {
      const m = /^([a-z0-9]+)-(v|h)$/.exec(clip); const s = m && Object.hasOwn(SHOTS, m[1]) ? SHOTS[m[1]] : null;
      if (!s) throw new Error(`no capture recipe for ${clip}`);
      const tag = m[2], phone = tag === "v";
      const vp = phone ? { width: 432, height: 768, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true } : { width: 1920, height: 1080, deviceScaleFactor: 1 };
      const size = phone ? [1080, 1920] : [1920, 1080];
      const ctx = await browser.createBrowserContext(); const pg = await ctx.newPage();
      await pg.setViewport(vp); if (phone) await pg.setUserAgent(MOBILE_UA);
      if (s.stub) {
        await pg.setRequestInterception(true);
        pg.on("request", (r) => (/\/api\/auth\/me(\?|$)/.test(r.url()) ? r.respond({ status: 200, contentType: "application/json", body: PROBE_ME }) : r.continue()));
      }
      const out = join(outDir, `${clip}.mp4`); const t0 = Date.now();
      const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "30", "-i", "-",
        "-vf", `scale=${size[0]}:${size[1]}:force_original_aspect_ratio=decrease,pad=${size[0]}:${size[1]}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", out], { stdio: ["pipe", "inherit", "inherit"] });
      const cdp = await pg.createCDPSession(); let last = null;
      cdp.on("Page.screencastFrame", (f) => { last = Buffer.from(f.data, "base64"); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
      const tick = setInterval(() => { if (last) ff.stdin.write(last); }, 1000 / 30);
      try {
        await pg.goto(s.url, { waitUntil: "domcontentloaded", timeout: 90000 });
        if (s.warm) await W(s.warm);
        await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: size[0], maxHeight: size[1], everyNthFrame: 1 });
        await s.run(pg);
      } finally {
        clearInterval(tick); await cdp.send("Page.stopScreencast").catch(() => {});
        await ctx.close(); ff.stdin.end(); await new Promise((r) => ff.on("close", r));
      }
      done.push({ clip, url: s.url, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), bytes: statSync(out).size });
  };
  try {   // a few pages at once (separate browser contexts) so a long spot's footage fits the job lease
    const queue = [...clips];
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
  } finally { await browser.close(); }
  return done.sort((a, b) => a.clip.localeCompare(b.clip));
}
