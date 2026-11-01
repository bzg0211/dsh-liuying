"""流萤语音监听：群里/私聊有人说「说XX」「语音XX」「叫XX」时，用流萤音色说出来。

流程：SnowLuma WS 监听 -> 匹配语音请求 -> speak-liuying.py 合成 -> 发送语音条。
独立运行，不动桥接；和点歌器一样是后台小工。
运行：python voice-watch.py
"""
import asyncio
import json
import os
import re
import subprocess
import time

import websockets

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_PY = r"D:\dk\feiyu\venv\Scripts\python.exe"
SPEAK = os.path.join(ROOT, "speak-liuying.py")
WS_URL = "ws://127.0.0.1:3002/"
WS_TOKEN = "h-BTQRJqwmxdMQpVvRKc80nBvpT49cGKYEGQsA-xTVc"
TARGET_GROUPS = {1050286085, 1130083324}
PRIVATE_OWNER = 2324772973
SNOWLUMA_HTTP = "http://127.0.0.1:3000"
TOKEN = "0R_QL4YFKr0BKhNGubnZjN9-xiSeX5LxwGWbJ5ZmX4k"

PATTERNS = [
    # 精确触发：流萤说XXX / 语音：XXX / 说句话：XXX / 说：XXX（避免「说真的」这类误触）
    re.compile(r"(?:^|\s)(?:流萤说|语音\s*[:：]?|说句话\s*[:：]?)\s*(.+)$"),
    re.compile(r"(?:^|\s)说\s*[:：]\s*(.+)$"),
]

_LOCK = asyncio.Lock()


def log(msg):
    line = f"[voice {time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(os.path.join(ROOT, "voice-watch.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def extract_say(text):
    if not text:
        return None
    for p in PATTERNS:
        m = p.search(text)
        if m:
            t = m.group(1).strip().strip('\u300a\u300b"\'\\u201c\\u201d')
            t = t[:120]
            if t and len(t) >= 2:
                return t
    return None


def send_voice(target, path):
    import urllib.request
    kind, tid = target
    payload = {"message": [{"type": "record", "data": {"file": "file:///" + path.replace("\\", "/")}}]}
    endpoint = "send_group_msg" if kind == "group" else "send_private_msg"
    payload["group_id" if kind == "group" else "user_id"] = tid
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(f"{SNOWLUMA_HTTP}/{endpoint}", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json; charset=utf-8"})
    try:
        r = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        log(f"语音发送 {kind} {tid}: ok {r[:80]}")
        return True
    except Exception as e:
        log(f"语音发送失败: {e}")
        return False


def speak(text, out):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    subprocess.run([VENV_PY, SPEAK, "--text", text, "--out", out],
                   env=env, check=True, timeout=120)


async def handle_say(text, target):
    async with _LOCK:
        log(f"语音请求: {text} target={target}")
        out = os.path.join(ROOT, f"say-{int(time.time())}.wav")
        try:
            speak(text, out)
            send_voice(target, out)
        except Exception as e:
            log(f"合成失败: {e}")


async def main():
    while True:
        try:
            async with websockets.connect(WS_URL, additional_headers={"Authorization": f"Bearer {WS_TOKEN}"}) as ws:
                log(f"connected {WS_URL}")
                async for raw in ws:
                    ev = json.loads(raw)
                    if ev.get("post_type") != "message":
                        continue
                    kind = ev.get("message_type")
                    target = None
                    if kind == "group" and ev.get("group_id") in TARGET_GROUPS:
                        target = ("group", ev["group_id"])
                    elif kind == "private" and ev.get("user_id") == PRIVATE_OWNER:
                        target = ("private", ev["user_id"])
                    if not target:
                        continue
                    parts = ev.get("message") or []
                    if isinstance(parts, str):
                        text = parts
                    else:
                        text = "".join(p.get("data", {}).get("text", "") for p in parts
                                       if p.get("type") == "text")
                    say = extract_say(text)
                    if say:
                        asyncio.create_task(handle_say(say, target))
        except Exception as e:
            log(f"connection error: {e}; retry in 10s")
            await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
