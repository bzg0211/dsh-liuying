/**
 * 本机冒烟测试：用本机路径跑一次 speak()，确认插件流水线可用。
 * 用法：node scripts/smoke.mjs "要说的话"
 */
import path from "node:path";
import { speak } from "../lib/speak.js";

const settings = {
  enabled: true,
  python: String.raw`D:\dk\feiyu\venv\Scripts\python.exe`,
  ffmpeg: String.raw`D:\dk\ffmpeg\bin\ffmpeg.exe`,
  applio: String.raw`D:\dk\feiyu\Applio-main`,
  model: String.raw`D:\dk\feiyu\models\liuying.pth`,
  index: String.raw`D:\dk\feiyu\models\liuying.index`,
  ttsVoice: "zh-CN-XiaoxiaoNeural",
  ttsRate: -8,
  pitch: 0,
  protect: 0.33,
  indexRate: 0.3,
  f0Method: "rmvpe",
  timeoutMs: 120000,
  outDir: String.raw`D:\dk\liuying-voice\out`,
};

const text = process.argv[2] || "你好，我是流萤。";
const result = await speak(text, settings);
console.log(JSON.stringify({ ...result, size: path.basename(result.path) }));
