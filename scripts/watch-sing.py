"""Watch QQ group/private messages for song requests and auto-run the singing pipeline.

Connects to SnowLuma OneBot WebSocket, listens for messages in the target group
and private chat, and when a message matches the "sing <song>" pattern runs
sing.py and posts the result back.

Auto-reconnects when SnowLuma drops; songs are processed one at a time.
Run (venv python):
  D:\\dk\\feiyu\\venv\\Scripts\\python.exe D:\\dk\\feiyu\\watch-sing.py
"""
import asyncio
import json
import os
import re
import subprocess
import time

import websockets

ROOT = r"D:\dk\feiyu"
VENV_PY = os.path.join(ROOT, "venv", "Scripts", "python.exe")
WS_URL = "ws://127.0.0.1:3002/"
WS_TOKEN = "h-BTQRJqwmxdMQpVvRKc80nBvpT49cGKYEGQsA-xTVc"
TARGET_GROUPS = {1050286085, 1130083324}
PRIVATE_OWNER = 2324772973
SNOWLUMA_HTTP = "http://127.0.0.1:3000"
TOKEN = "0R_QL4YFKr0BKhNGubnZjN9-xiSeX5LxwGWbJ5ZmX4k"

PATTERNS = [
    re.compile(r"(?:^|\s)(?:唱|点歌|来一首|来首|唱一首|唱个)\s*[::]?\s*(.+)$"),
]

_SING_LOCK = asyncio.Lock()


def log(msg):
    line = f"[watch {time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(os.path.join(ROOT, "watch.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def extract_song(text):
    if not text:
        return None
    for p in PATTERNS:
        m = p.search(text)
        if m:
            song = m.group(1).strip().strip('\u300a\u300b"\'\\u201c\\u201d')
            song = song[:40]
            if song:
                return song
    return None


def send_message(target, text):
    """target: ('group', id) or ('private', id)"""
    import urllib.request
    kind, tid = target
    payload = {"message": [{"type": "text", "data": {"text": text}}]}
    endpoint = "send_group_msg" if kind == "group" else "send_private_msg"
    payload["group_id" if kind == "group" else "user_id"] = tid
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(f"{SNOWLUMA_HTTP}/{endpoint}", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json; charset=utf-8"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        log(f"sent {kind} {tid}: {text[:40]}")
    except Exception as e:
        log(f"send fail: {e}")


def run_song(song, target):
    log(f"点歌: {song} target={target}")
    send_message(target, f"收到《{song}》……我去唱，等几分钟")
    try:
        cmd = [VENV_PY, os.path.join(ROOT, "sing.py"), song,
               "--caption", f"《{song}》流萤版"]
        if target[0] == "group":
            cmd += ["--group", str(target[1])]
        else:
            cmd += ["--user", str(target[1])]
        subprocess.run(cmd, cwd=ROOT, timeout=1800)
        log(f"唱完了: {song}")
    except Exception as e:
        log(f"sing fail: {e}")
        send_message(target, f"《{song}》唱失败了…{e}")


async def run_song_serial(song, target):
    if _SING_LOCK.locked():
        send_message(target, f"《{song}》先等等……前面还有一首")
    async with _SING_LOCK:
        await asyncio.to_thread(run_song, song, target)


def handle_message(evt):
    mtype = evt.get("post_type")
    if mtype != "message":
        return
    msg_type = evt.get("message_type")
    parts = evt.get("message") or []
    text = "".join(p.get("data", {}).get("text", "") for p in parts
                   if p.get("type") == "text")
    song = extract_song(text)
    if not song:
        return
    if msg_type == "group":
        gid = int(evt.get("group_id", 0))
        if gid not in TARGET_GROUPS:
            return
        target = ("group", gid)
    elif msg_type == "private":
        uid = int(evt.get("user_id", 0))
        if uid != PRIVATE_OWNER:
            return
        target = ("private", uid)
    else:
        return
    log(f"matched song={song} target={target} from={evt.get('user_id')}")
    asyncio.ensure_future(run_song_serial(song, target))


async def connect_once():
    async with websockets.connect(WS_URL, additional_headers={"Authorization": f"Bearer {WS_TOKEN}"}) as ws:
        log("connected " + WS_URL)
        while True:
            raw = await ws.recv()
            try:
                evt = json.loads(raw)
            except Exception:
                continue
            handle_message(evt)


async def main():
    while True:
        try:
            await connect_once()
        except Exception as e:
            log(f"connection error: {e}; retry in 10s")
            await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
