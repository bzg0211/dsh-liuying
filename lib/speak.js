/**
 * dsh-liuying-voice — 流萤语音合成流水线。
 *
 * 文字 -> edge-tts（普通女声）-> RVC 音色转换（用户自备 .pth 模型）-> wav。
 *
 * 本模块只负责“生成文件”，不碰 DSH / QQ。路径和命令全部来自配置，
 * 默认值仅用于本机自检；发布版要求用户在设置里填好自己的环境。
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, "rvc-worker.py");
export const PLUGIN_ROOT = path.resolve(__dirname, "..");

/** 把 TTS 的失败原因写进 apply.log，方便排查 */
function diag(line) {
  try {
    appendFileSync(path.join(PLUGIN_ROOT, "apply.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {}
}

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
  useWorker: true, // 常驻 RVC 进程，省掉每次加载模型
  qqGuard: true, // 守护 SnowLuma / 桥接
  snowLumaDir: "",
  snowLumaNode: "",
  bridgeDir: "",
  bridgeNode: "",
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

/** 子进程基础环境：剔除空代理变量，补齐 Windows 关键变量。 */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
  ]) {
    // 空字符串代理会让 aiohttp/requests 走一个无效代理，直接删掉
    if (!env[k] || !String(env[k]).trim()) delete env[k];
  }
  if (!env.SystemRoot) env.SystemRoot = "C:\\Windows";
  if (!env.windir) env.windir = env.SystemRoot;
  if (!env.TEMP) env.TEMP = env.TMP || "C:\\Windows\\Temp";
  if (!env.TMP) env.TMP = env.TEMP;
  return env;
}

// ---------- 常驻 RVC worker：模型只加载一次 ----------

let worker = null;

function workerEnv(settings) {
  return childEnv({
    APPLIO_DIR: settings.applio,
    APPLIO_CONFIG_FILE: path.join(settings.applio, "..", "applio-config.json"),
    APPLIO_LOGS_DIR: path.join(settings.applio, "..", "applio-logs"),
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || "4",
    PYTHONIOENCODING: "utf-8",
  });
}

let idleTimer = null;
const WORKER_IDLE_MS = 10 * 60 * 1000;

/** 每次用完之后重置空闲计时：十分钟没人用就释放显存 */
function touchWorker() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    stopWorker();
  }, WORKER_IDLE_MS);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

export function stopWorker() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!worker) return;
  const w = worker;
  worker = null;
  try {
    w.proc.stdin.write(JSON.stringify({ op: "exit" }) + "\n");
  } catch {}
  setTimeout(() => {
    try {
      w.proc.kill();
    } catch {}
  }, 1500);
  for (const job of w.queue) job.reject(new Error("worker stopped"));
  w.queue.length = 0;
}

function ensureWorker(settings) {
  if (worker && worker.proc.exitCode === null) return worker;
  const proc = spawn(settings.python, [WORKER_SCRIPT], {
    cwd: settings.applio,
    env: workerEnv(settings),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const w = { proc, queue: [], buf: "" };
  worker = w;

  const failAll = (error) => {
    if (worker === w) worker = null;
    for (const job of w.queue) job.reject(error);
    w.queue.length = 0;
  };

  proc.stdout.on("data", (d) => {
    w.buf += d.toString("utf8");
    let idx;
    while ((idx = w.buf.indexOf("\n")) >= 0) {
      const line = w.buf.slice(0, idx).trim();
      w.buf = w.buf.slice(idx + 1);
      if (!line.startsWith("{")) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.ready) continue;
      const job = w.queue.shift();
      if (!job) continue;
      if (msg.ok) job.resolve(msg);
      else job.reject(new Error(String(msg.error ?? "worker error").slice(-400)));
    }
  });
  // core 的日志会刷满 stderr，必须一直读掉，否则管道阻塞
  proc.stderr.on("data", () => {});
  proc.on("close", () => failAll(new Error("worker exited")));
  proc.on("error", (e) => failAll(e));
  return w;
}

function workerRequest(settings, payload, timeoutMs = 120000) {
  const w = ensureWorker(settings);
  touchWorker();
  return new Promise((resolve, reject) => {
    const job = { resolve, reject };
    job.timer = setTimeout(() => {
      const i = w.queue.indexOf(job);
      if (i >= 0) w.queue.splice(i, 1);
      reject(new Error("worker 超时"));
    }, timeoutMs);
    w.queue.push(job);
    try {
      w.proc.stdin.write(JSON.stringify(payload) + "\n");
    } catch (error) {
      clearTimeout(job.timer);
      const i = w.queue.indexOf(job);
      if (i >= 0) w.queue.splice(i, 1);
      reject(error);
    }
  });
}

export function workerInfer(settings, input, output, timeoutMs = 120000, extra = {}) {
  return workerRequest(
    settings,
    {
      ...extra,
      input,
      output,
      pth: settings.model,
      index: settings.index || "",
      pitch: settings.pitch,
      protect: settings.protect,
      index_rate: settings.indexRate,
      f0_method: settings.f0Method,
    },
    timeoutMs,
  );
}

/** 在常驻进程里做 TTS：省掉每次启动 python 的时间 */
function workerTts(settings, text, outPath, timeoutMs = 120000) {
  return workerRequest(
    settings,
    {
      op: "tts",
      text,
      out: outPath,
      voice: settings.ttsVoice,
      rate: `${settings.ttsRate}%`,
    },
    timeoutMs,
  );
}

/** 预热：后台加载模型，第一次朗读就不用等 */
export function warmup(settings) {
  try {
    if (!settings?.python || !existsSync(settings.python) || !existsSync(settings.applio)) return;
    ensureWorker(settings);
  } catch {}
}

function run(cmd, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: childEnv(env),
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
    // 1. edge-tts（优先常驻进程，省掉启动 python 的时间）
    //    edge-tts 偶尔会空返回：重建常驻进程重试，再不行才退回命令行
    const ttsArgs = ["-m", "edge_tts", "--voice", s.ttsVoice, `--rate=${s.ttsRate}%`, "--text", t, "--write-media", ttsMp3];
    if (s.useWorker !== false) {
      let ttsOk = false;
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !ttsOk; attempt++) {
        try {
          await workerTts(s, t, ttsMp3, s.timeoutMs);
          ttsOk = true;
        } catch (error) {
          lastError = error;
          stopWorker(); // 换一个干净的常驻进程再试
        }
      }
      if (!ttsOk) {
        try {
          await run(python, ttsArgs, { timeoutMs: s.timeoutMs });
          diag("TTS 常驻进程失败，CLI 成功");
        } catch (cliError) {
          diag(`TTS CLI 也失败：${String(cliError?.message ?? cliError).slice(-400)}`);
          throw lastError;
        }
      }
    } else {
      await run(python, ttsArgs, { timeoutMs: s.timeoutMs });
    }
    // 2 + 3. RVC 音色转换：优先常驻 worker 直接吃 mp3（省掉转码），失败再退回命令行
    const rvcEnv = {
      APPLIO_CONFIG_FILE: path.join(applio, "..", "applio-config.json"),
      APPLIO_LOGS_DIR: path.join(applio, "..", "applio-logs"),
      OMP_NUM_THREADS: "4",
      PYTHONIOENCODING: "utf-8",
    };
    const cliArgs = (input) => [
      "core.py", "infer",
      "--input-path", input,
      "--output-path", outPath,
      "--pth-path", model,
      "--index-path", s.index || path.join(path.dirname(model), "liuying.index"),
      "--pitch", String(s.pitch),
      "--protect", String(s.protect),
      "--index-rate", String(s.indexRate),
      "--f0-method", s.f0Method,
    ];
    if (s.useWorker !== false) {
      try {
        await workerInfer(s, ttsMp3, outPath, s.timeoutMs);
      } catch (workerError) {
        stopWorker();
        await run(ffmpeg, ["-y", "-i", ttsMp3, "-ar", "40000", "-ac", "1", ttsWav], { timeoutMs: s.timeoutMs });
        try {
          await run(python, cliArgs(ttsWav), { cwd: applio, env: rvcEnv, timeoutMs: s.timeoutMs });
        } catch {
          throw workerError;
        }
      }
    } else {
      await run(ffmpeg, ["-y", "-i", ttsMp3, "-ar", "40000", "-ac", "1", ttsWav], { timeoutMs: s.timeoutMs });
      await run(python, cliArgs(ttsWav), { cwd: applio, env: rvcEnv, timeoutMs: s.timeoutMs });
    }
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
