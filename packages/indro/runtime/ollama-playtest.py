#!/usr/bin/env python3
"""Bounded local Ollama driver for Digital Breakdown's --agent-playtest bridge."""
import argparse, json, os, re, subprocess, sys, time, urllib.request

STATE = re.compile(r"^AGENT_STATE (.*)$")
FRAME = re.compile(r"^AGENT_FRAME_(OK|FAILED) path=(.*)$")
ALLOWED = {"frames","moveX","moveZ","lookX","lookY","sprint","vacuum","jump","melee","shoot","camera","reason"}

SYSTEM = """You control a player in Digital Breakdown through legal controller inputs only.
Return exactly one JSON object. Goal: survive, move intentionally, fight humans when useful, expose and vacuum loose souls, and make progress.
Schema: {"reason":"short","frames":1..120,"moveX":-1..1,"moveZ":-1..1,"lookX":-400..400,"lookY":-400..400,"sprint":bool,"vacuum":bool,"jump":bool,"melee":bool,"shoot":bool,"camera":bool}.
Prefer 6-30 frames per decision. Do not emit prose outside JSON. You cannot alter game state or use a shell."""

def post(model, state):
    body = json.dumps({"model":model,"stream":False,"format":"json","options":{"temperature":0.2},"messages":[{"role":"system","content":SYSTEM},{"role":"user","content":state}]}).encode()
    req=urllib.request.Request("http://127.0.0.1:11434/api/chat",data=body,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        outer=json.load(r)
    return json.loads(outer["message"]["content"])

def clamp(v, lo, hi): return max(lo,min(hi,float(v)))
def action(raw):
    if not isinstance(raw,dict) or any(k not in ALLOWED for k in raw): raise ValueError("invalid keys")
    a={"frames":int(clamp(raw.get("frames",12),1,120)),"moveX":clamp(raw.get("moveX",0),-1,1),"moveZ":clamp(raw.get("moveZ",0),-1,1),"lookX":clamp(raw.get("lookX",0),-400,400),"lookY":clamp(raw.get("lookY",0),-400,400)}
    for k in ("sprint","vacuum","jump","melee","shoot","camera"): a[k]=bool(raw.get(k,False))
    a["reason"]=str(raw.get("reason",""))[:240]
    return a

def command(a):
    b=lambda x:"1" if x else "0"
    return f"step frames={a['frames']} moveX={a['moveX']:.3f} moveZ={a['moveZ']:.3f} lookX={a['lookX']:.3f} lookY={a['lookY']:.3f} sprint={b(a['sprint'])} vacuum={b(a['vacuum'])} jump={b(a['jump'])} melee={b(a['melee'])} shoot={b(a['shoot'])} camera={b(a['camera'])}"

def read_observation(p):
    state=frame=None
    while True:
        line=p.stdout.readline()
        if not line: raise RuntimeError("game bridge ended")
        line=line.rstrip(); print("GAME",line)
        m=STATE.match(line)
        if m: state=m.group(1)
        f=FRAME.match(line)
        if f: frame=f.group(2) if f.group(1)=="OK" else None
        if state is not None and (f or line.startswith("AGENT_PLAYTEST_ERROR")): return state,frame

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--exe",required=True); ap.add_argument("--model",default="qwen2.5:7b"); ap.add_argument("--turns",type=int,default=30); args=ap.parse_args()
    logdir=os.path.join(os.environ.get("LOCALAPPDATA",os.getcwd()),"DigitalBreakdownDev","agent-runs",time.strftime("%Y%m%d-%H%M%S")); os.makedirs(logdir,exist_ok=True)
    frame=os.path.join(logdir,"current-frame.ppm")
    p=subprocess.Popen([args.exe,"--agent-playtest",f"--agent-frame={frame}"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
    transcript=[]; invalid=0
    try:
        state,framepath=read_observation(p)
        for turn in range(1,args.turns+1):
            try: a=action(post(args.model,"Current authoritative game observation:\nAGENT_STATE "+state))
            except Exception as e:
                invalid+=1; print(f"MODEL_RETRY turn={turn} error={e}"); a={"reason":"fallback observation step","frames":6,"moveX":0.0,"moveZ":0.0,"lookX":20.0,"lookY":0.0,"sprint":False,"vacuum":False,"jump":False,"melee":False,"shoot":False,"camera":False}
            cmd=command(a); print(f"AGENT turn={turn} reason={a['reason']} command={cmd}")
            p.stdin.write(cmd+"\n"); p.stdin.flush(); nextstate,framepath=read_observation(p)
            transcript.append({"turn":turn,"state":state,"action":a,"result":nextstate,"frame":framepath}); state=nextstate
            if "dead=1" in state:
                print("AGENT_DEAD resetting"); p.stdin.write("reset\n"); p.stdin.flush(); state,framepath=read_observation(p)
        print(f"AGENT_RUN_OK model={args.model} turns={args.turns} invalid={invalid} log={logdir}")
    finally:
        try: p.stdin.write("quit\n"); p.stdin.flush()
        except Exception: pass
        try: p.wait(timeout=5)
        except Exception: p.kill()
        with open(os.path.join(logdir,"transcript.json"),"w",encoding="utf-8") as f: json.dump({"model":args.model,"invalid":invalid,"turns":transcript},f,indent=2)
if __name__=="__main__": main()
