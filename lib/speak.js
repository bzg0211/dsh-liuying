/**
 * dsh-liuying-voice — 流萤语音合成流水线。
 *
 * 文字 -> edge-tts（普通女声）-> RVC 音色转换（用户自备 .pth 模型）-> wav。
 *
 * 本模块只负责“生成文件”，不碰 DSH / QQ。路径和命令全部来自配置，
 * 默认值仅用于本机自检；发布版要求用户在设置里填好自己的环境。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(__dirname, "..");

/** 默认设置；用户设置会覆盖。 */
export const DEFAULTS = {
  enabled: true,
  sendMode: "mix", // text | voice | mix
  voiceRatio: 0.5, // mix 模式下语音比例（0~1）
  python: "",
  ffmpeg: "",
  applio: "",
  model: "",
  index: "",
  ttsVoice: "zh-CN-XiaoxiaoNeural",
  ttsRate: -8,
  pitch: 0,
  protect: 0.33,
  indexRate: 0.3,
  f0Method: "rmvpe",
  timeoutMs: 120000,
  outDir: "",
};

export function resolveSettings(saved = {}) {
  const s = { ...DEFAULTS, ...saved };
  if (!s.outDir) s.outDir = path.join(PLUGIN_ROOT, "out");
  // 默认音色：插件自带的流萤模型（500 轮官方语音版）
  if (!s.model) s.model = path.join(PLUGIN_ROOT, "models", "liuying.pth");
  return s;
}

function run(cmd, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`超时（${timeoutMs}ms）：${cmd}`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `${cmd} exit ${code}`).slice(-500)));
    });
  });
}

function requireFile(label, p) {
  if (!p) throw new Error(`缺少配置：${label}`);
  if (!existsSync(p)) throw new Error(`${label} 不存在：${p}`);
  return p;
}

/**
 * 生成一条流萤语音。
 * @param {string} text 要说的文字
 * @param {object} settings resolveSettings() 的结果
 * @param {object} [opts] { outPath, log }
 * @returns {Promise<{path:string, bytes:number, duration:number}>}
 */
export async function speak(text, settings, opts = {}) {
  const s = settings;
  const t = String(text ?? "").trim();
  if (!t) throw new Error("text 为空");
  if (t.length > 300) throw new Error("text 过长（上限 300 字）");

  const python = requireFile("python", s.python);
  const ffmpeg = requireFile("ffmpeg", s.ffmpeg);
  const applio = requireFile("applio", s.applio);
  const model = requireFile("model(.pth)", s.model);

  mkdirSync(s.outDir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outPath = opts.outPath || path.join(s.outDir, `liuying-${stamp}.wav`);
  const ttsMp3 = path.join(s.outDir, `liuying-${stamp}.tts.mp3`);
  const ttsWav = path.join(s.outDir, `liuying-${stamp}.tts.wav`);

  try {
    // 1. edge-tts
    await run(
      python,
      ["-m", "edge_tts", "--voice", s.ttsVoice, `--rate=${s.ttsRate}%`, "--text", t, "--write-media", ttsMp3],
      { timeoutMs: s.timeoutMs },
    );
    // 2. 转 40k 单声道 wav
    await run(ffmpeg, ["-y", "-i", ttsMp3, "-ar", "40000", "-ac", "1", ttsWav], { timeoutMs: s.timeoutMs });
    // 3. RVC 音色转换
    const args = [
      "core.py", "infer",
      "--input-path", ttsWav,
      "--output-path", outPath,
      "--pth-path", model,
      "--index-path", s.index || path.join(path.dirname(model), "liuying.index"),
      "--pitch", String(s.pitch),
      "--protect", String(s.protect),
      "--index-rate", String(s.indexRate),
      "--f0-method", s.f0Method,
    ];
    await run(python, args, {
      cwd: applio,
      env: {
        APPLIO_CONFIG_FILE: path.join(applio, "..", "applio-config.json"),
        APPLIO_LOGS_DIR: path.join(applio, "..", "applio-logs"),
        OMP_NUM_THREADS: "4",
        PYTHONIOENCODING: "utf-8",
      },
      timeoutMs: s.timeoutMs,
    });
    const bytes = statSync(outPath).size;
    if (bytes < 1024) throw new Error("生成的文件过小，可能失败");
    return { path: outPath, bytes, duration: 0 };
  } finally {
    for (const f of [ttsMp3, ttsWav]) {
      try {
        rmSync(f, { force: true });
      } catch {}
    }
  }
}
