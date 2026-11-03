/**
 * dsh-liuying-voice — DSH host plugin.
 *
 * 注册一个 agent 可调用的工具 liuying_speak：输入一段文字，输出一条流萤
 * 音色的语音文件（wav）。模型与外部程序路径来自设置（$DSH_HOME/liuying-voice/settings.json）。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describeSettings, loadSettings, saveSettings } from "./config.js";
import { PLUGIN_ROOT, speak, stopWorker, warmup } from "./speak.js";
import { noteDshPort, startQQGuard, stopQQGuard } from "./qq-guard.js";
import { sing } from "./sing.js";

function diag(msg) {
  try {
    const file = path.join("D:\\dk\\liuying-voice", "apply.log");
    // 日志别无限长：超过 512KB 就重开
    try {
      if (statSync(file).size > 512 * 1024) rmSync(file, { force: true });
    } catch {}
    appendFileSync(file, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {}
}

export const name = "liuying-voice";
export const inject = ["tools", "webServer"];

const TOOL_NAME = "liuying_speak";
const TOOL_TIMEOUT_MS = 180000;

let disposeTool = null;
let latest = {};

function log(msg) {
  try {
    console.log(`[liuying-voice] ${msg}`);
  } catch {}
}

function createTool(ctx) {
  return {
    name: TOOL_NAME,
    description:
      "用「流萤」的音色把一段文字说成语音文件（本地 edge-tts + RVC）。当你想让用户听到流萤的声音、或需要一条语音而不是文字时调用。" +
      "只接受要说的话本身，不要包含解释或 markdown。生成的是本地 wav 文件，返回文件路径。",
    timeoutMs: TOOL_TIMEOUT_MS,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "要说的话（尽量简短，300 字以内）" },
        outPath: { type: "string", description: "可选：自定义输出 wav 路径；不给则用插件输出目录" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          bytes: { type: "integer" },
        },
        required: ["path", "bytes"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const text = typeof args?.text === "string" ? args.text : "";
      if (!text.trim()) throw new Error("text 不能为空");
      const { settings } = loadSettings();
      if (settings.enabled === false) throw new Error("流萤语音已禁用（设置里 enabled=false）");
      const result = await speak(text, settings, { outPath: args?.outPath || undefined });
      latest = describeSettings(settings);
      return { path: result.path, bytes: result.bytes };
    },
  };
}

function createSingTool() {
  return {
    name: "liuying_sing",
    description:
      "用「流萤」的音色唱一首歌：搜索网易云 → 下载 → 分离人声伴奏 → RVC 换声 → 混音，输出一条 wav。" +
      "当用户想听流萤唱歌、或让你唱某首歌时调用。耗时约 2~4 分钟。",
    timeoutMs: 900000,
    parameters: {
      type: "object",
      properties: {
        song: { type: "string", description: "歌名，如「不眠之夜」" },
      },
      required: ["song"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          bytes: { type: "integer" },
          song: { type: "string" },
        },
        required: ["path", "bytes", "song"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const name = typeof args?.song === "string" ? args.song.trim() : "";
      if (!name) throw new Error("song 不能为空");
      const { settings } = loadSettings();
      if (settings.enabled === false) throw new Error("流萤语音已禁用（设置里 enabled=false）");
      const result = await sing(name, settings);
      return { path: result.path, bytes: result.bytes, song: result.song };
    },
  };
}

async function register(ctx) {
  const tools = ctx.get("tools");
  if (!tools?.register) {
    log("tools 服务不可用，跳过工具注册");
    return;
  }
  try {
    const disposers = [];
    disposers.push(tools.register(createTool(ctx)));
    disposers.push(tools.register(createSingTool()));
    disposeTool = () => disposers.forEach((d) => {
      try {
        if (typeof d === "function") d();
      } catch {}
    });
    log(`工具已注册：${TOOL_NAME} / liuying_sing`);
  } catch (error) {
    disposeTool = null;
    log(`工具注册失败：${error?.message ?? error}`);
  }
}

function mountMemory(ctx) {
  const web = ctx.get("webServer");
  if (!web?.register) return null;
  return web.register({
    kind: "exact",
    path: "/liuying-voice/memory",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const pick = url.searchParams.get("p") || "";
      const memDir = path.join(PLUGIN_ROOT, "memory");
      const entries = [];
      try {
        const walk = (dir, rel = "") => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const r = rel ? rel + "/" + e.name : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), r);
            else if (e.name.endsWith(".md")) entries.push({ rel: r, file: path.join(dir, e.name) });
          }
        };
        walk(memDir);
      } catch {}
      const filtered = entries.filter((e) => !q || e.rel.toLowerCase().includes(q)).sort((a, b) => a.rel.localeCompare(b.rel));

      let content = "";
      if (pick) {
        const hit = filtered.find((e) => e.rel === decodeURIComponent(pick));
        if (hit) {
          try {
            content = readFileSync(hit.file, "utf8");
            if (content.length > 30000) content = content.slice(0, 30000) + "\n\n（已截断）";
          } catch {
            content = "（读取失败）";
          }
        }
      }

      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>流萤记忆</title>
<style>body{font-family:system-ui,sans-serif;max-width:920px;margin:24px auto;padding:0 16px;background:#111;color:#eee}
input{padding:8px;width:100%;margin:12px 0;background:#222;color:#eee;border:1px solid #555;border-radius:6px}
li{margin:5px 0} a{color:#9cf;text-decoration:none} a:hover{text-decoration:underline}
pre{background:#1a1a1a;padding:14px;border-radius:8px;white-space:pre-wrap;max-height:62vh;overflow:auto;line-height:1.5}
.muted{opacity:.6;font-size:13px}</style></head>
<body><h2>流萤记忆 · ${entries.length} 篇</h2>
<form method="get"><input name="q" value="${esc(q)}" placeholder="搜索文件名…"></form>
<ul>${filtered.map((e) => `<li><a href="?q=${encodeURIComponent(q)}&p=${encodeURIComponent(e.rel)}">${esc(e.rel)}</a></li>`).join("")}</ul>
${content ? `<h3>${esc(pick)}</h3><pre>${esc(content)}</pre>` : `<p class="muted">点文件名查看内容</p>`}
</body></html>`;
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    },
  });
}

const SPEAK_CACHE_DIR = path.join(PLUGIN_ROOT, "out", "cache");
const SPEAK_CACHE_MAX = 300 * 1024 * 1024;

/** 同一段文字 + 同一套参数 => 同一份音频 */
function speakCacheKey(text, settings) {
  return createHash("sha1")
    .update(
      JSON.stringify([
        text,
        settings.ttsVoice,
        settings.ttsRate,
        settings.pitch,
        settings.protect,
        settings.indexRate,
        settings.f0Method,
        settings.model,
      ]),
    )
    .digest("hex");
}

function trimSpeakCache(keep) {
  try {
    mkdirSync(SPEAK_CACHE_DIR, { recursive: true });
    const files = readdirSync(SPEAK_CACHE_DIR)
      .filter((n) => n.endsWith(".wav"))
      .map((n) => {
        const p = path.join(SPEAK_CACHE_DIR, n);
        const st = statSync(p);
        return { p, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files) {
      if (total <= SPEAK_CACHE_MAX) break;
      if (f.p === keep) continue;
      try {
        rmSync(f.p, { force: true });
        total -= f.size;
      } catch {}
    }
  } catch {}
}

function mountSpeak(ctx) {
  const web = ctx.get("webServer");
  if (!web?.register) return null;
  return web.register({
    kind: "exact",
    path: "/liuying-voice/speak",
    handler: async (req, res) => {
      noteDshPort(req.headers?.host);
      const sendJson = (code, body) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST") {
        sendJson(405, { ok: false, error: "method-not-allowed" });
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        sendJson(400, { ok: false, error: "invalid-json" });
        return;
      }
      const text = String(body.text ?? "").trim().slice(0, 300);
      if (!text) {
        sendJson(400, { ok: false, error: "text-required" });
        return;
      }
      const sendWav = (buf) => {
        res.statusCode = 200;
        res.setHeader("content-type", "audio/wav");
        res.setHeader("content-length", String(buf.length));
        res.end(buf);
      };
      try {
        const { settings } = loadSettings();
        if (settings.enabled === false) throw new Error("流萤语音已禁用");
        const target = path.join(SPEAK_CACHE_DIR, `${speakCacheKey(text, settings)}.wav`);
        // 命中缓存：刷新页面之后也是秒回
        if (existsSync(target)) {
          sendWav(readFileSync(target));
          log(`页面朗读（缓存）：${text.slice(0, 20)}…`);
          return;
        }
        mkdirSync(SPEAK_CACHE_DIR, { recursive: true });
        const r = await speak(text, settings, { outPath: target });
        trimSpeakCache(target);
        sendWav(readFileSync(r.path));
        log(`页面朗读：${text.slice(0, 20)}…`);
      } catch (error) {
        sendJson(500, { ok: false, error: String(error?.message ?? error).slice(-300) });
      }
    },
  });
}

function mountTest(ctx) {
  const web = ctx.get("webServer");
  if (!web?.register) return null;
  return web.register({
    kind: "exact",
    path: "/liuying-voice/test",
    handler: async (req, res) => {
      const send = (code, body) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST") {
        send(405, { ok: false, error: "method-not-allowed" });
        return;
      }
      try {
        const { settings } = loadSettings();
        if (settings.enabled === false) throw new Error("已禁用");
        const r = await speak("你好，我是流萤。", settings);
        log(`试听生成：${r.path}`);
        send(200, { ok: true, path: r.path, bytes: r.bytes });
      } catch (error) {
        send(500, { ok: false, error: String(error?.message ?? error).slice(-300) });
      }
    },
  });
}

function mountSettings(ctx) {
  const web = ctx.get("webServer");
  if (!web?.register) return null;
  return web.register({
    kind: "exact",
    path: "/liuying-voice/settings",
    handler: async (req, res) => {
      noteDshPort(req.headers?.host);
      const send = (code, body) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET") {
        const { settings } = loadSettings();
        send(200, describeSettings(settings));
        return;
      }
      if (req.method === "PUT" || req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          send(400, { ok: false, error: "invalid-json" });
          return;
        }
        const next = saveSettings(body);
        log("设置已保存");
        send(200, { ok: true, settings: describeSettings(next) });
        return;
      }
      send(405, { ok: false, error: "method-not-allowed" });
    },
  });
}

export async function apply(ctx, config = {}) {
  diag(`apply 开始；webServer=${ctx.get("webServer") ? "有" : "无"}；tools=${ctx.get("tools") ? "有" : "无"}`);
  // 把 profile 里的 config 当作初始设置合并（不覆盖用户已保存的）
  if (config && typeof config === "object") {
    const { saved } = loadSettings();
    if (!saved || Object.keys(saved).length === 0) saveSettings(config);
  }
  await register(ctx);
  let disposeSettings = null;
  let disposeMemory = null;
  try {
    const dispose = mountSettings(ctx);
    disposeSettings = typeof dispose === "function" ? dispose : null;
    if (disposeSettings === null) log("webServer 不可用，设置接口未挂载");
    else log("设置接口已挂载：/liuying-voice/settings");
  } catch (error) {
    log(`设置接口挂载失败：${error?.message ?? error}`);
  }
  try {
    const dispose = mountMemory(ctx);
    disposeMemory = typeof dispose === "function" ? dispose : null;
    if (disposeMemory !== null) log("记忆页面已挂载：/liuying-voice/memory");
  } catch (error) {
    log(`记忆页面挂载失败：${error?.message ?? error}`);
  }
  try {
    const dispose = mountTest(ctx);
    if (typeof dispose === "function") {
      const prev = disposeMemory;
      disposeMemory = () => {
        if (typeof prev === "function") prev();
        dispose();
      };
    }
    log("试听接口已挂载：/liuying-voice/test");
  } catch (error) {
    log(`试听接口挂载失败：${error?.message ?? error}`);
  }
  try {
    const dispose = mountSpeak(ctx);
    if (typeof dispose === "function") {
      const prev = disposeMemory;
      disposeMemory = () => {
        if (typeof prev === "function") prev();
        dispose();
      };
    }
    log("页面朗读接口已挂载：/liuying-voice/speak");
  } catch (error) {
    log(`页面朗读接口挂载失败：${error?.message ?? error}`);
  }
  // 后台预热 RVC 常驻进程：第一次朗读就不用等加载
  let stopGuard = null;
  const warmTimer = setTimeout(() => {
    try {
      const { settings } = loadSettings();
      warmup(settings);
      log("RVC 常驻进程预热中");
      stopGuard = startQQGuard(settings, log);
    } catch {}
  }, 3000);

  ctx.effect(() => () => {
    clearTimeout(warmTimer);
    // 只停守护定时器；已经拉起的 SnowLuma / 桥接继续跑（下次启动会检测到）
    if (typeof stopGuard === "function") stopGuard();
    stopWorker();
    if (typeof disposeTool === "function") disposeTool();
    if (typeof disposeSettings === "function") disposeSettings();
    if (typeof disposeMemory === "function") disposeMemory();
    disposeTool = null;
    disposeSettings = null;
    disposeMemory = null;
  }, "liuying-voice: dispose tool");
}
