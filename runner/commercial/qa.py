#!/usr/bin/env python3
"""Grade one rendered commercial against the measurable Founder rules (runner port of the Mac kit qa3.py).
usage: qa.py <file.mp4> <spot-file-name>  -> JSON {pass, checks{...}, lufs, truePeak, seconds, size, price{...}}
Not in the runner: the Whisper "what the machine heard" pass (Mac-only mlx). The voice script is fixed in spots.py."""
import os, re, sys, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import priceguard

def sh(*a): return subprocess.run([str(x) for x in a], capture_output=True, text=True)
f, name = sys.argv[1], sys.argv[2]
d = float(sh("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f).stdout)
wh = sh("ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f).stdout.strip()
has_audio = bool(sh("ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", f).stdout.strip())
ln = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", sh("ffmpeg", "-i", f, "-af", "loudnorm=print_format=json", "-f", "null", "-").stderr)[-1])
se = sh("ffmpeg", "-i", f, "-af", "silencedetect=n=-35dB:d=0.8", "-f", "null", "-").stderr
ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", se)]
gaps = [float(a) for a, e in zip(re.findall(r"silence_start: ([\d.]+)", se), ends + [d] * 9) if e < d - 0.15 and float(a) < d - 2.2]
price = priceguard.scan(f, 2.0); pf = {"frames": price[1], "priceFrames": len({h["t"] for h in price[0]}), "samples": [f"{h['t']}s {h['text']}" for h in price[0][:6]]}
kind = "master" if ("MASTER" in name or "PARTNER" in name) else ("hook" if "-15s" in name else "30s")
lim = {"master": (60, 100), "30s": (18, 34), "hook": (8, 15.5)}[kind]
checks = {
    "length": lim[0] <= d <= lim[1],
    "-14 LUFS (±1)": abs(float(ln["input_i"]) + 14) <= 1.0,
    "true peak ≤ -1 dBTP": float(ln["input_tp"]) <= -1.0,
    "voice keeps talking (no ≥0.8 s silence before the end card)": not gaps,
    "size": wh in ("1080,1920", "1920,1080"),
    "audio stream": has_audio,
    "no price on screen (Tesseract OCR, 2 frames/s)": pf["priceFrames"] == 0,
}
print(json.dumps({"pass": all(checks.values()), "kind": kind, "seconds": round(d, 2), "size": wh.replace(",", "x"), "lufs": float(ln["input_i"]),
                  "truePeak": float(ln["input_tp"]), "silenceGapsAt": gaps, "price": pf, "checks": checks,
                  "notRun": "speech-to-text pass (Whisper) runs on the Mac kit only"}))
