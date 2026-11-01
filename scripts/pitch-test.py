import subprocess

VENV = r"D:\dk\feiyu\venv\Scripts\python.exe"
FFMPEG = r"D:\dk\ffmpeg\bin\ffmpeg.exe"
APPLIO = r"D:\dk\feiyu\Applio-main"
MODEL = r"D:\dk\feiyu\models\liuying.pth"
TEXT = "嗯……你听听，这个音色对不对。我是流萤。"
BASE = r"D:\dk\liuying-voice\out\pitch-test"

subprocess.run([VENV, "-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural", "--rate=-8%",
                "--text", TEXT, "--write-media", BASE + ".tts.mp3"], check=True)
subprocess.run([FFMPEG, "-y", "-i", BASE + ".tts.mp3", "-ar", "40000", "-ac", "1", BASE + ".tts.wav"], check=True)

for pitch in (0, 4, 8):
    out = f"{BASE}-p{pitch}.wav"
    subprocess.run([VENV, "core.py", "infer",
                    "--input-path", BASE + ".tts.wav",
                    "--output-path", out,
                    "--pth-path", MODEL,
                    "--index-path", r"D:\dk\feiyu\models\liuying.index",
                    "--pitch", str(pitch), "--protect", "0.33", "--index-rate", "0.3",
                    "--f0-method", "rmvpe"],
                   cwd=APPLIO, check=True)
    print("OK", out, flush=True)
