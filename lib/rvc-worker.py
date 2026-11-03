"""常驻 RVC 推理进程（Applio core）。

启动时加载一次依赖与模型缓存，之后每条朗读只做推理本身，
省掉每次 5~8 秒的进程启动和模型加载。

用法：由插件通过 stdin/stdout 发送 JSON 行（每行一个请求）：
  {"input": "x.wav", "output": "y.wav", "pth": "model.pth",
   "index": "model.index", "pitch": 0, "protect": 0.33,
   "index_rate": 0.3, "f0_method": "rmvpe", "embedder": "contentvec"}
响应：
  {"ok": true, "result": "..."}
  {"ok": false, "error": "..."}
"""
import json
import os
import sys
import traceback

# 让 `import core` 能找到 Applio（脚本不在 Applio 目录下运行）
_APPLIO = os.environ.get("APPLIO_DIR") or os.getcwd()
if _APPLIO and _APPLIO not in sys.path:
    sys.path.insert(0, _APPLIO)


def _net_selftest():
    """DSH 里 spawn 的 python 到底能不能连外网：结果写 apply.log。"""
    import time as _t
    import urllib.request as _u

    log = r"D:\dk\liuying-voice\apply.log"
    for host in ("https://speech.platform.bing.com", "https://www.baidu.com"):
        try:
            t0 = _t.time()
            _u.urlopen(host, timeout=6)
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"worker net OK {host} {_t.time()-t0:.1f}s\n")
        except Exception as e:
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"worker net FAIL {host}: {type(e).__name__} {str(e)[:120]}\n")


try:
    _net_selftest()
except Exception:
    pass

from core import run_infer_script

import asyncio

import edge_tts

# core 里会大量 print，把标准输出让给 JSON 协议，其余全部转到 stderr
_OUT = sys.stdout
sys.stdout = sys.stderr


def reply(payload):
    _OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _OUT.flush()


def handle(req):
    return run_infer_script(
        pitch=int(req.get("pitch", 0)),
        index_rate=float(req.get("index_rate", 0.3)),
        volume_envelope=float(req.get("volume_envelope", 1.0)),
        protect=float(req.get("protect", 0.33)),
        f0_method=str(req.get("f0_method", "rmvpe")),
        input_path=req["input"],
        output_path=req["output"],
        pth_path=req["pth"],
        index_path=req.get("index") or "",
        split_audio=bool(req.get("split_audio", False)),
        f0_autotune=False,
        f0_autotune_strength=1.0,
        proposed_pitch=False,
        proposed_pitch_threshold=0.05,
        export_format="wav",
        embedder_model=str(req.get("embedder", "contentvec")),
    )


def handle_tts(req):
    voice = req.get("voice") or "zh-CN-XiaoxiaoNeural"
    rate = req.get("rate") or "-8%"

    async def go():
        communicate = edge_tts.Communicate(req["text"], voice, rate=rate)
        await communicate.save(req["out"])

    asyncio.run(go())
    return "tts-ok"


def main():
    # 先输出 ready，方便调用方知道模型已加载
    reply({"ok": True, "ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            reply({"ok": False, "error": "bad-json"})
            continue
        if req.get("op") == "exit":
            break
        try:
            if req.get("op") == "tts":
                result = handle_tts(req)
            else:
                result = handle(req)
            reply({"ok": True, "result": str(result)})
        except Exception:
            reply({"ok": False, "error": traceback.format_exc()[-800:]})


if __name__ == "__main__":
    main()
