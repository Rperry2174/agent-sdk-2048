#!/usr/bin/env python3
"""Moves, score and biggest tile inside a normalized 30 s clip window (frames S-30 .. S+1769)."""
import json, sys, os
run, player = sys.argv[1], sys.argv[2]
c = json.load(open(os.path.join(run, f"{player}-clip.json")))
S = c["startFrame"]; f0, t0 = c["sample0"]["frame"], c["sample0"]["t"]
f1, t1 = c["sample1"]["frame"], c["sample1"]["t"]
fps = (f1 - f0) / ((t1 - t0) / 1000)            # measured emulator frames per wall second
end = S - 30 + 1800
P = [json.loads(l) for l in open(os.path.join(run, f"{player}.presses.jsonl"))]
inclip = [p for p in P if p["moved"] and f0 + (p["tEnd"] - t0) / 1000 * fps <= end]
last = inclip[-1] if inclip else None
print(json.dumps({"startFrame": S, "clipFirstFrame": S - 30, "clipLastFrame": end - 2, "speed": c["speed"],
  "start": c["startBoard"], "end": {"score": last["score"] if last else c["startBoard"]["score"], "maxTile": last["maxTile"] if last else c["startBoard"]["maxTile"]},
  "movesInClip": len(inclip), "warmUpMs": (c.get("warm") or {}).get("warmMs")}))
