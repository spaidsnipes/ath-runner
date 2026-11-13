#!/usr/bin/env python3
"""Value first: no prices on screen (Linux port of priceblur.swift / priceocr.swift, Tesseract instead of Apple Vision).
  priceguard.py scan  <video> [fps]        -> JSON hits [{t, text, box:[x,y,w,h]}]
  priceguard.py blur  <in.mp4> <out.mp4>   -> pixelate every price box found at 4 fps (±0.4 s window); copies when clean
  priceguard.py check <video>              -> JSON {frames, priceFrames, samples}; the grade fails when priceFrames > 0"""
import os, re, sys, json, glob, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor

PRICE = re.compile(r"(\$\s?\d)|(\d\s?/\s?mo\b)|(/\s?mo(nth)?\b)|(\b(a|per)\s+month\b)|(\d+(\.\d\d)?\s?(usd|dollars?)\b)", re.I)

def sh(*a): return subprocess.run([str(x) for x in a], capture_output=True, text=True)

def ocr(img):
    r = sh("tesseract", img, "stdout", "--psm", "11", "tsv")
    lines = {}
    for row in r.stdout.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or not c[11].strip() or float(c[10] or -1) < 30: continue
        key = (c[2], c[3], c[4]); x, y, w, h = map(int, c[6:10])
        lines.setdefault(key, []).append((c[11], x, y, w, h))
    hits = []
    for words in lines.values():
        text = " ".join(w[0] for w in words)
        if not PRICE.search(text): continue
        sel = [w for w in words if re.search(r"[\d$]|/mo|month|usd|dollar", w[0], re.I)] or words
        x0 = min(w[1] for w in sel); y0 = min(w[2] for w in sel); x1 = max(w[1] + w[3] for w in sel); y1 = max(w[2] + w[4] for w in sel)
        hits.append({"text": text[:80], "box": [x0, y0, x1 - x0, y1 - y0]})
    return hits

def scan(video, fps=2.0):
    td = tempfile.mkdtemp(prefix="pg-")
    try:
        sh("ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={fps}", "-q:v", "2", f"{td}/%05d.png")
        frames = sorted(glob.glob(f"{td}/*.png"))
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex: res = list(ex.map(ocr, frames))
        out = []
        for i, hs in enumerate(res):
            for h in hs: out.append({"t": round(i / fps, 2), **h})
        return out, len(frames)
    finally: shutil.rmtree(td, ignore_errors=True)

def blur(src, dst, fps=4.0):
    hits, _ = scan(src, fps)
    if not hits: shutil.copyfile(src, dst); return {"boxes": 0}
    W, H = map(int, sh("ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", src).stdout.strip().split(","))
    # merge the same (rounded) box across consecutive samples into one time window
    win = {}
    for h in hits:
        x, y, w, hh = h["box"]; pad = 14
        x, y = max(0, x - pad), max(0, y - pad); w, hh = min(W - x, w + 2 * pad), min(H - y, hh + 2 * pad)
        k = (x // 24, y // 24, w // 24, hh // 24)
        a, b = h["t"] - 0.4, h["t"] + 0.4
        win.setdefault(k, {"box": (x, y, w // 2 * 2 or 2, hh // 2 * 2 or 2), "spans": []})["spans"].append((max(0, a), b))
    boxes = []
    for v in win.values():
        sp = sorted(v["spans"]); m = [list(sp[0])]
        for a, b in sp[1:]:
            if a <= m[-1][1]: m[-1][1] = max(m[-1][1], b)
            else: m.append([a, b])
        for a, b in m: boxes.append((v["box"], a, b))
    boxes = boxes[:80]
    fc = [f"[0:v]split={len(boxes) + 1}[base]" + "".join(f"[s{i}]" for i in range(len(boxes)))]
    prev = "[base]"
    for i, ((x, y, w, h), a, b) in enumerate(boxes):
        fc.append(f"[s{i}]crop={w}:{h}:{x}:{y},scale=max(2\\,iw/18):max(2\\,ih/18):flags=area,scale={w}:{h}:flags=neighbor,boxblur=6[p{i}]")
        fc.append(f"{prev}[p{i}]overlay={x}:{y}:enable='between(t,{a:.2f},{b:.2f})'[o{i}]"); prev = f"[o{i}]"
    r = sh("ffmpeg", "-y", "-v", "error", "-i", src, "-filter_complex", ";".join(fc), "-map", prev, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", dst)
    if r.returncode: raise SystemExit("blur failed: " + r.stderr[-600:])
    return {"boxes": len(boxes), "samples": [h["text"] for h in hits[:6]]}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "scan": print(json.dumps(scan(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 2.0)[0]))
    elif cmd == "blur": print(json.dumps(blur(sys.argv[2], sys.argv[3])))
    elif cmd == "check":
        hits, n = scan(sys.argv[2], 2.0)
        print(json.dumps({"frames": n, "priceFrames": len({h["t"] for h in hits}), "samples": [f"{h['t']}s {h['text']}" for h in hits[:6]]}))
    else: raise SystemExit(__doc__)
