#!/usr/bin/env python3
"""ATH commercials v3 on the GitHub runner (Linux port of the Mac kit build3.py, 2026-11-12).
Rooms = Google Flow stills/video (AI imagery, labelled) whose screens carry REAL live-app footage captured headless in this run.
Voice = Kokoro (am_fenrir, kokoro-onnx, local CPU) — AI voice, disclosed on the end card. Value first: no prices on screen.
Private inputs (Flow stills/door clip, Dspaid's songs) are NOT in this public repo: they arrive at run time as the job's kit
zip through the OIDC-gated queue (flow/*, songs/passport.m4a, songs/kingdavid.m4a).
usage:
  build.py clips <spot> <v|h>                      -> JSON list of captured clips this cut needs ("wavsites-h", ...)
  build.py build <spot> <v|h> --kit D --raw D --work D --out FILE.mp4 --models D
  build.py list                                     -> JSON list of spot names (video spots only)"""
import os, sys, json, re, hashlib, subprocess, argparse
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spots import SPOTS

FPS = 30; GAP = 0.16; VOICE = "am_fenrir"
GOLD = (212, 175, 55); WHITE = (255, 255, 255)
# Linux fonts (apt: fonts-dejavu-core, fonts-lato). Mac kit used Didot + Avenir Next (Apple system fonts, not shipped here).
SERIF = os.environ.get("ATH_SERIF", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
SANS = {0: "/usr/share/fonts/truetype/lato/Lato-Regular.ttf", 2: "/usr/share/fonts/truetype/lato/Lato-Medium.ttf",
        5: "/usr/share/fonts/truetype/lato/Lato-Semibold.ttf", 8: "/usr/share/fonts/truetype/lato/Lato-Heavy.ttf"}
SANS_FALLBACK = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SONG_CREDIT = {"passport": "Passport Boys — Dspaid", "kingdavid": "King David — Dspaid"}
ROOMS = {  # room stills (768x1376); screen quads TL, TR, BR, BL in source pixels
    "living":  ("flow1112-living-lights.jpg", [(132, 602), (412, 626), (412, 806), (132, 814)]),
    "cinema":  ("flow1112-cinema.jpg", [(198, 492), (584, 492), (584, 754), (198, 754)]),
    "board":   ("flow1112-boardroom.jpg", [(282, 558), (538, 558), (538, 704), (282, 704)]),
    "studio":  ("flow1112-studio.jpg", [(142, 186), (508, 262), (500, 494), (132, 462)]),
    "trading": ("flow1112-trading-office.jpg", [(82, 730), (690, 730), (690, 848), (82, 848)]),
}
A = None  # parsed args (paths)

def run(*a):
    r = subprocess.run([str(x) for x in a], capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"FAILED {' '.join(map(str, a))[:300]}\n{r.stderr[-1500:]}")
    return r
def dur(p): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)
def font(kind, s, i=0):
    if kind == "serif": return ImageFont.truetype(SERIF, s)
    p = SANS.get(i) or SANS[min(SANS, key=lambda k: abs(k - i))]
    return ImageFont.truetype(p if os.path.exists(p) else SANS_FALLBACK, s)

def geom(o):
    if o == "v": return dict(W=1080, H=1920, cap_y=1170, cap_size=66, cap_w=860, cap_cx=510, label=(60, 1490), lab_size=28)
    return dict(W=1920, H=1080, cap_y=800, cap_size=58, cap_w=1400, cap_cx=960, label=(48, 1024), lab_size=24)
def frame(o): return (1080, 1920) if o == "v" else (1920, 1080)

def chunks(text):
    words = text.split(); out = []; cur = []
    for w in words:
        if cur and (len(" ".join(cur + [w])) > 30 or (cur[-1][-1] in ".?!—…" and len(" ".join(cur)) > 12)): out.append(" ".join(cur)); cur = []
        cur.append(w)
    if cur: out.append(" ".join(cur))
    groups = []; i = 0
    while i < len(out):
        if i + 1 < len(out) and len(out[i]) + len(out[i + 1]) <= 52 and out[i][-1] not in ".?!": groups.append([out[i], out[i + 1]]); i += 2
        else: groups.append([out[i]]); i += 1
    return groups

def caption_png(g, lines, path):
    W, H = g["W"], g["H"]; im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); size = g["cap_size"]; f = font("sans", size, 8)
    while max(d.textlength(l, font=f) for l in lines) > g["cap_w"] and size > 40: size -= 2; f = font("sans", size, 8)
    lh = int(size * 1.22); bw = max(d.textlength(l, font=f) for l in lines) + 56; bh = lh * len(lines) + 34
    x0 = g["cap_cx"] - bw / 2; y0 = g["cap_y"]
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=22, fill=(6, 6, 10, 232), outline=GOLD + (150,), width=2)
    for i, l in enumerate(lines):
        w = d.textlength(l, font=f); x = g["cap_cx"] - w / 2; y = y0 + 14 + i * lh
        for dx, dy in ((-3, 0), (3, 0), (0, -3), (0, 3), (-2, -2), (2, 2), (-2, 2), (2, -2)): d.text((x + dx, y + dy), l, font=f, fill=(0, 0, 0, 230))
        d.text((x, y), l, font=f, fill=(GOLD if re.search(r"One key|Every door|there's more|Founding 500", l) else WHITE) + (255,))
    im.save(path)

_kokoro = None
def tts(text):
    global _kokoro
    h = hashlib.sha1((VOICE + text).encode()).hexdigest()[:12]; p = f"{A.work}/vo-{h}.wav"
    if not os.path.exists(p):
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            _kokoro = Kokoro(f"{A.models}/kokoro-v1.0.onnx", f"{A.models}/voices-v1.0.bin")
        import soundfile as sf
        s, sr = _kokoro.create(text, voice=VOICE, speed=1.0, lang="en-us"); sf.write(p + ".raw.wav", s, sr)
        run("ffmpeg", "-y", "-v", "error", "-i", p + ".raw.wav", "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse,aresample=48000", "-ac", "1", p)
        os.remove(p + ".raw.wav")
    return p

def enc(): return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]

def room_seg(o, room, clip, t0, D, out, light=True, zoom=0.10):
    W, H = frame(o); still, quad = ROOMS[room]; src = f"{A.kit}/flow/{still}"
    cx = sum(p[0] for p in quad) / 4; cy = sum(p[1] for p in quad) / 4
    if o == "v": k = 1080 / 768; oy = (1376 * k - 1920) / 2
    else: k = 1920 / 768; oy = min(max(cy * k - 540, 0), 1376 * k - 1080)
    q = [(x * k, y * k - oy) for x, y in quad]
    x0, y0 = int(min(p[0] for p in q)), int(min(p[1] for p in q)); x1, y1 = int(max(p[0] for p in q)) + 1, int(max(p[1] for p in q)) + 1
    bw, bh = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    rel = [(p[0] - x0, p[1] - y0) for p in q]
    mask = out + ".mask.png"; m = Image.new("L", (bw, bh), 0); ImageDraw.Draw(m).polygon(rel, fill=255); m.save(mask)
    (tl, tr, br, bl) = rel
    fsrc = f"{A.raw}/{clip}-h.mp4"; FD = dur(fsrc); t0 = max(0.0, min(t0, FD - D)) if FD > D else 0.0
    base = f"[0:v]scale={W}:{int(1376 * k) // 2 * 2},crop={W}:{H}:0:{int(oy)},format=yuv420p"
    if light: base += f",eq=brightness='-0.42+0.42*min(t/1.1\\,1)':saturation='0.6+0.4*min(t/1.1\\,1)':eval=frame"
    base += "[bg]"
    fg = (f"[1:v]fps={FPS},scale={bw}:{bh},tpad=stop_mode=clone:stop_duration={max(0, D - FD + 0.2):.2f},"
          f"perspective=x0={tl[0]:.1f}:y0={tl[1]:.1f}:x1={tr[0]:.1f}:y1={tr[1]:.1f}:x2={bl[0]:.1f}:y2={bl[1]:.1f}:x3={br[0]:.1f}:y3={br[1]:.1f}:sense=destination,"
          f"eq=brightness=0.02:contrast=1.05,format=yuva420p[f0];[2:v]format=gray,scale={bw}:{bh}[mk];[f0][mk]alphamerge,fade=in:st={0.9 if light else 0.2}:d=0.35:alpha=1[fg]")
    cxn = min(max((cx * k) / W, 0.15), 0.85); cyn = min(max((cy * k - oy) / H, 0.15), 0.85)
    zp = (f"[bg][fg]overlay={x0}:{y0},zoompan=z='1+{zoom}*on/{max(1, int(D * FPS))}':x='(iw-iw/zoom)*{cxn:.3f}':y='(ih-ih/zoom)*{cyn:.3f}':d=1:s={W}x{H}:fps={FPS},format=yuv420p[v]")
    run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-i", src, "-ss", f"{t0:.2f}", "-i", fsrc, "-loop", "1", "-i", mask,
        "-filter_complex", ";".join([base, fg, zp]), "-map", "[v]", "-t", f"{D:.3f}", "-r", str(FPS), *enc(), out)

def flow_seg(o, name, t0, D, out):
    W, H = frame(o); src = f"{A.kit}/flow/{name}"; FD = dur(src)
    vf = f"fps={FPS},scale={W}:-2,crop={W}:{H}:0:(ih-{H})*0.42" if o == "h" else f"fps={FPS},scale={W}:{H}"
    vf += f",tpad=stop_mode=clone:stop_duration={max(0, D - (FD - t0) + 0.2):.2f},format=yuv420p"
    run("ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.2f}", "-i", src, "-t", f"{D:.3f}", "-vf", vf, "-an", "-r", str(FPS), *enc(), out)

def app_seg(o, clip, t0, D, out, crop=None, hold=False, upto=None):
    g = geom(o); W, H = g["W"], g["H"]; src = f"{A.raw}/{clip}-{o}.mp4"
    FD = dur(src) if upto is None else min(dur(src), upto)
    if not hold: t0 = max(0.0, min(t0, FD - D)) if FD > D else 0.0   # pull back toward the clip start so it never runs dry
    vf = [f"fps={FPS}"] + ([f"crop={crop}"] if crop else []) + [f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
          f"tpad=stop_mode=clone:stop_duration={max(0, D - (FD - t0)) + 0.2:.2f}", "format=yuv420p"]
    run("ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.2f}", "-t", f"{min(D, max(0.1, FD - t0)):.3f}", "-i", src, "-t", f"{D:.3f}", "-vf", ",".join(vf), "-an", "-r", str(FPS), *enc(), out)

def endcard(o, spot, path):
    W, H = frame(o); v = W == 1080; im = Image.new("RGB", (W, H), (5, 6, 9))
    bg = Image.open(f"{A.kit}/flow/flow1112-door-fob.jpg").convert("RGB")
    if v: bg = bg.resize((1080, int(1376 * 1080 / 768))).crop((0, 0, 1080, 1920))
    else: bg = bg.resize((1920, int(1376 * 1920 / 768))); bg = bg.crop((0, int(bg.height * 0.35), 1920, int(bg.height * 0.35) + 1080))
    im = Image.blend(im, bg, 0.28); d = ImageDraw.Draw(im)
    def center(t, y, f, c):
        w = d.textlength(t, font=f); d.text(((W - w) / 2, y), t, font=f, fill=c)
    y = 560 if v else 250
    for i, t in enumerate(spot["card"]):
        f = font("serif", 96 if v else 88) if i == 0 else font("sans", 54 if v else 46, 5)
        while d.textlength(t, font=f) > W - 140: f = font("serif", f.size - 4) if i == 0 else font("sans", f.size - 4, 5)
        center(t, y, f, GOLD if i == 0 else (240, 236, 224)); y += (130 if v else 112) if i == 0 else (74 if v else 62)
    url = spot["url"]; f = font("sans", 60 if v else 52, 8); w = d.textlength(url, font=f)
    d.rounded_rectangle([(W - w) / 2 - 36, y + 34, (W + w) / 2 + 36, y + 34 + (100 if v else 88)], radius=50, fill=GOLD)
    d.text(((W - w) / 2, y + 48), url, font=f, fill=(10, 10, 12)); y += 34 + (100 if v else 88)
    if spot.get("urgency"): center(spot["urgency"], y + 36, font("sans", 44 if v else 38, 8), (255, 236, 170))
    yb = 1460 if v else 900
    center("ABOVE THE HILL — THERE'S MORE.", yb, font("sans", 36 if v else 30, 5), GOLD)
    feet = ([spot["disclaimer"]] if spot.get("disclaimer") else []) + [
        "AI voice. Rooms are AI imagery (Google Flow); every screen is the real live app.", "Music: " + SONG_CREDIT[spot["song"]]]
    yy = yb + (60 if v else 46); ff = font("sans", 27 if v else 22, 2)
    for ft in feet:
        line = ""
        for w_ in ft.split():
            if line and d.textlength(line + " " + w_, font=ff) > W - 160: center(line, yy, ff, (175, 170, 160)); yy += int(ff.size * 1.35); line = w_
            else: line = (line + " " + w_).strip()
        center(line, yy, ff, (175, 170, 160)); yy += int(ff.size * 1.35)
    im.save(path)

def mix_audio(Bd, spot, beats, vos, end_vo, bd, endt, total, video, final):
    parts = []; gp = f"{Bd}/gap.wav"
    run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(GAP), gp)
    for i, (b, v) in enumerate(zip(beats, vos)):
        if b.get("pre"): sp = f"{Bd}/pre{i}.wav"; run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(b["pre"]), sp); parts.append(sp)
        parts += [v, gp]
    parts.append(end_vo)
    with open(f"{Bd}/vo.txt", "w") as fh: fh.writelines(f"file '{p}'\n" for p in parts)
    vo_wav = f"{Bd}/vo.wav"; run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{Bd}/vo.txt", "-ac", "1", "-ar", "48000", vo_wav)
    song = f"{A.kit}/songs/{spot['song']}.m4a"
    knock = ("0.55*exp(-300*(t-{a}))*sin(2*PI*180*t)*between(t,{a},{a}+0.05)+0.55*exp(-300*(t-{a}-0.16))*sin(2*PI*170*t)*between(t,{a}+0.16,{a}+0.21)"
             "+0.9*exp(-6*(t-{a}-0.32))*sin(2*PI*55*t)*gte(t,{a}+0.32)+0.25*exp(-2.5*(t-{a}-0.42))*(sin(2*PI*(880+300*(t-{a}-0.42))*t)+sin(2*PI*(1320+450*(t-{a}-0.42))*t))*gte(t,{a}+0.42)").format(a=f"{endt:.3f}")
    door = ("0.6*exp(-300*t)*sin(2*PI*170*t)*between(t,0,0.05)+0.6*exp(-300*(t-0.18))*sin(2*PI*165*t)*between(t,0.18,0.23)"
            "+0.30*sin(2*PI*2900*t)*(between(t,0.62,0.72)+between(t,0.82,0.92))+0.5*exp(-25*(t-1.05))*(random(1)*2-1)*between(t,1.05,1.25)") if spot.get("door") else "0"
    sfx = f"{Bd}/sfx.wav"; run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"aevalsrc='{door}+{knock}':s=48000:d={total:.3f}", "-ac", "2", sfx)
    mix = f"{Bd}/mix.wav"; ss = spot.get("song_at", 0)
    fca = (f"[1:a]atrim=start={ss},asetpts=PTS-STARTPTS,aresample=48000,highpass=f=50,equalizer=f=1800:t=q:w=1.2:g=-7,volume=0.22,"
           f"afade=in:d=0.8,volume='if(gte(t,{endt:.2f}),2.2,1)':eval=frame,afade=out:st={total - 1.2:.2f}:d=1.2[bed];"
           f"[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=1.6[v];[v]asplit[v1][v2];"
           f"[bed][v2]sidechaincompress=threshold=0.015:ratio=14:attack=20:release=350[duck];[v1][duck][2:a]amix=inputs=3:duration=longest:normalize=0,atrim=0:{total:.3f}[a]")
    run("ffmpeg", "-y", "-v", "error", "-i", vo_wav, "-i", song, "-i", sfx, "-filter_complex", fca, "-map", "[a]", "-ar", "48000", mix)
    m = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", run("ffmpeg", "-i", mix, "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-").stderr)[-1])
    ln = f"loudnorm=I=-14:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    run("ffmpeg", "-y", "-v", "error", "-i", video, "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", ln + ",aresample=48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", final)

def build(name, o):
    spot = SPOTS[name]; W, H = frame(o); g = geom(o); Bd = A.work; os.makedirs(Bd, exist_ok=True)
    beats = spot["beats"]; vos = [tts(b["say"]) for b in beats]; end_vo = tts(spot["end_say"])
    bd = [b.get("pre", 0) + dur(v) + GAP for b, v in zip(beats, vos)]
    C = 3.0; tail = max(dur(end_vo) + 0.9 - C, 0.0); vl = bd[:]; vl[-1] += tail
    X = [0.0] + [b.get("x", 0.4) for b in beats[1:]] + [0.45]
    segs = []
    for i, (b, L) in enumerate(zip(beats, vl)):
        p = f"{Bd}/s{i:02d}.mp4"; D = L + X[i + 1]
        if b["kind"] == "room": room_seg(o, b["room"], b["clip"], b.get("t0", 0), D, p, light=b.get("light", True))
        elif b["kind"] == "flow": flow_seg(o, b["src"], b.get("t0", 0), D, p)
        else: app_seg(o, b["clip"], b["t"][0] if o == "v" else b["t"][1], D, p, crop=b.get("crop_h") if o == "h" else None, hold=b.get("hold", False), upto=(b.get("upto") or (None, None))[0 if o == "v" else 1])
        segs.append(p)
    ec = f"{Bd}/end.png"; endcard(o, spot, ec); pe = f"{Bd}/end.mp4"
    run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-i", ec, "-t", f"{C:.3f}", "-vf", f"zoompan=z='1+0.0007*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},format=yuv420p", *enc(), pe)
    segs.append(pe)
    args = []; [args.extend(["-i", s]) for s in segs]; fc = []; prev = "[0:v]"; acc = 0.0
    for i in range(1, len(segs)):
        acc += vl[i - 1]; tr = beats[i]["tr"] if i < len(beats) and "tr" in beats[i] else ("fadeblack" if i == len(segs) - 1 else "fade")
        fc.append(f"{prev}[{i}:v]xfade=transition={tr}:duration={X[i]}:offset={acc:.3f}[x{i}]"); prev = f"[x{i}]"
    total = sum(vl) + C
    ov = []; t = 0.0; k = 0
    for b, v, L in zip(beats, vos, bd):
        vd = dur(v); s0 = t + b.get("pre", 0); groups = chunks(b.get("cap", b["say"])); tot = sum(len(" ".join(gp)) for gp in groups)
        for gp in groups:
            share = vd * len(" ".join(gp)) / tot; p = f"{Bd}/c{k:03d}.png"; caption_png(g, gp, p); ov.append((p, s0, s0 + share + (GAP if gp is groups[-1] else 0))); s0 += share; k += 1
        t += L
    s0 = sum(bd); cut = sum(vl); groups = chunks(spot.get("end_cap", spot["end_say"])); tot = sum(len(" ".join(gp)) for gp in groups); ed = dur(end_vo)
    for gp in groups:
        share = ed * len(" ".join(gp)) / tot
        if s0 < cut - 0.2: p = f"{Bd}/c{k:03d}.png"; caption_png(g, gp, p); ov.append((p, s0, min(s0 + share, cut))); k += 1
        s0 += share
    if spot.get("disclaimer"):   # WM Pro's required line only while WM Pro is on screen
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(im); f2 = font("sans", g["lab_size"] - 2, 2); t2 = spot["disclaimer"]; w2 = dd.textlength(t2, font=f2)
        x, y = ((W - w2) / 2, 1490) if W == 1080 else (48, 1024)
        dd.rounded_rectangle([x - 16, y - 8, x + w2 + 16, y + g["lab_size"] + 6], radius=12, fill=(0, 0, 0, 220)); dd.text((x, y), t2, font=f2, fill=(220, 214, 200, 255))
        lp = f"{Bd}/disc.png"; im.save(lp); tt = 0.0
        for b, L in zip(beats, vl):
            if b.get("wm"): ov.append((lp, tt, tt + L))
            tt += L
    n = len(segs)
    for j, (p, a, z) in enumerate(ov):
        args += ["-i", p]; fc.append(f"{prev}[{n + j}:v]overlay=0:0:enable='between(t,{a:.3f},{z:.3f})'[o{j}]"); prev = f"[o{j}]"
    silent = f"{Bd}/video.mp4"
    run("ffmpeg", "-y", "-v", "error", *args, "-filter_complex", ";".join(fc), "-map", prev, "-t", f"{total:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-tune", "film", silent)
    mix_audio(Bd, spot, beats, vos, end_vo, bd, sum(vl), total, silent, A.out)
    return {"spot": name, "file": spot["file"], "orientation": o, "seconds": round(dur(A.out), 2), "voice": f"kokoro-onnx {VOICE}",
            "song": SONG_CREDIT[spot["song"]], "beats": len(beats)}

def needed_clips(name, o):
    out = []
    for b in SPOTS[name].get("beats", []):
        if b["kind"] == "room": out.append(f"{b['clip']}-h")          # room screens always use the wide capture
        elif b["kind"] == "app": out.append(f"{b['clip']}-{o}")
    return sorted(set(out))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("spot", nargs="?"); ap.add_argument("o", nargs="?", default="v")
    for k in ("kit", "raw", "work", "out", "models"): ap.add_argument("--" + k)
    A = ap.parse_args()
    if A.cmd == "list": print(json.dumps([k for k, s in SPOTS.items() if not s.get("radio")])); raise SystemExit
    if A.spot not in SPOTS or SPOTS[A.spot].get("radio") or A.o not in ("v", "h"): raise SystemExit("unknown video spot or orientation")
    if A.cmd == "clips": print(json.dumps(needed_clips(A.spot, A.o))); raise SystemExit
    if A.cmd == "build": print(json.dumps(build(A.spot, A.o))); raise SystemExit
    raise SystemExit("usage: build.py list | clips <spot> <v|h> | build <spot> <v|h> --kit --raw --work --out --models")
