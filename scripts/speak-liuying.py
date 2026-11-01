"""流萤说话：文字 -> 流萤音色语音。

用法：python speak-liuying.py --text "晚安" [--out D:\dk\liuying\speak-out.wav]
流程：edge-tts（晓晓，温柔偏慢）-> ffmpeg 40k 单声道 -> RVC liuying 模型换声。
"""
import argparse
import os
import subprocess

VENV = r"D:\dk\feiyu\venv\Scripts\python.exe"
FFMPEG = r"D:\dk\ffmpeg\bin\ffmpeg.exe"
APPLIO = r"D:\dk\feiyu\Applio-main"
MODEL = r"D:\dk\feiyu\models\liuying.pth"
INDEX = r"D:\dk\feiyu\models\liuying.index"


def speak(text: str, out: str) -> str:
    base = os.path.splitext(out)[0]
    tts_mp3 = base + ".tts.mp3"
    tts_wav = base + ".tts.wav"
    subprocess.run(
        [VENV, "-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural",
         "--rate=-8%", "--text", text, "--write-media", tts_mp3],
        check=True,
    )
    subprocess.run(
        [FFMPEG, "-y", "-i", tts_mp3, "-ar", "40000", "-ac", "1", tts_wav],
        check=True,
    )
    env = {
        **os.environ,
        "APPLIO_CONFIG_FILE": r"D:\dk\feiyu\applio-config.json",
        "APPLIO_LOGS_DIR": r"D:\dk\feiyu\applio-logs",
        "OMP_NUM_THREADS": "4",
        "PYTHONIOENCODING": "utf-8",
    }
    subprocess.run(
        [VENV, "core.py", "infer", "--input-path", tts_wav, "--output-path", out,
         "--pth-path", MODEL, "--index-path", INDEX],
        cwd=APPLIO, env=env, check=True,
    )
    for f in (tts_mp3, tts_wav):
        try:
            os.remove(f)
        except OSError:
            pass
    print("OK", out)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", default=r"D:\dk\liuying\speak-out.wav")
    args = ap.parse_args()
    speak(args.text, args.out)
