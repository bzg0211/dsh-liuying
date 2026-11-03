/**
 * QQ 链路守护：让 SnowLuma 和桥接自己活着，不依赖外部脚本。
 *
 * - 每 60 秒探一次端口：5099（SnowLuma WebUI）、3100（桥接）
 * - 谁不在就拉起来（路径来自设置）
 * - DSH 的端口从页面请求的 Host 头里记下来，变了就改桥接的 config.json
 *   并重启插件自己拉起的那个桥接进程
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "liuying-voice");
const STATE_FILE = path.join(STATE_DIR, "qq-guard.json");

let timer = null;
let bridgeProc = null;
let snowProc = null;
let lastPortWarn = "";
let cachedPort = 0;

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const next = { ...readState(), ...patch };
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch {
    return {};
  }
}

/** 记下 DSH 正在监听的端口（从页面请求的 Host 头拿，最准） */
export function noteDshPort(hostHeader) {
  const port = Number(String(hostHeader ?? "").split(":").pop());
  if (!Number.isInteger(port) || port <= 0) return;
  if (port === cachedPort) return;
  cachedPort = port;
  writeState({ dshPort: port });
}

function probe(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(false);
      return;
    }
    const socket = net.connect({ port, host: "127.0.0.1" });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function spawnDetached(file, args, cwd, log, tag) {
  try {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", (e) => log?.(`${tag} 启动失败：${e?.message ?? e}`));
    child.unref();
    log?.(`${tag} 已启动`);
    return child;
  } catch (error) {
    log?.(`${tag} 启动异常：${error?.message ?? error}`);
    return null;
  }
}

function readBridgeConfig(bridgeDir) {
  const file = path.join(bridgeDir, "config.json");
  if (!existsSync(file)) return null;
  try {
    return { file, data: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return null;
  }
}

function syncBridgePort(settings, log) {
  const port = readState().dshPort || cachedPort;
  if (!port || !settings.bridgeDir) return false;
  const cfg = readBridgeConfig(settings.bridgeDir);
  if (!cfg?.data?.dsh) return false;
  const current = String(cfg.data.dsh.baseUrl || "");
  if (current === `http://127.0.0.1:${port}`) return false;
  cfg.data.dsh.baseUrl = `http://127.0.0.1:${port}`;
  try {
    writeFileSync(cfg.file, JSON.stringify(cfg.data, null, 2), "utf8");
    log?.(`桥接 baseUrl 已更新 -> ${port}`);
    // 插件自己拉起的桥接才重启；别人的不碰
    if (bridgeProc) {
      try {
        bridgeProc.kill();
      } catch {}
      bridgeProc = null;
    }
    return true;
  } catch (error) {
    log?.(`桥接配置写入失败：${error?.message ?? error}`);
    return false;
  }
}

async function tick(settings, log) {
  // 进程自己退出了就清掉引用，下一轮重新拉起
  if (snowProc && snowProc.exitCode !== null) snowProc = null;
  if (bridgeProc && bridgeProc.exitCode !== null) bridgeProc = null;

  // 1. SnowLuma
  if (settings.snowLumaDir && existsSync(settings.snowLumaDir)) {
    const up = await probe(5099);
    if (!up && !snowProc) {
      const nodeExe =
        settings.snowLumaNode && existsSync(settings.snowLumaNode)
          ? settings.snowLumaNode
          : path.join(settings.snowLumaDir, "node.exe");
      if (existsSync(nodeExe)) {
        snowProc = spawnDetached(nodeExe, ["index.mjs"], settings.snowLumaDir, log, "SnowLuma");
      } else {
        log?.("SnowLuma 的 node.exe 不存在，跳过");
      }
    }
  }

  // 2. 桥接
  if (settings.bridgeDir && existsSync(settings.bridgeDir)) {
    const up = await probe(3100);
    if (!up && !bridgeProc) {
      const nodeExe =
        settings.bridgeNode && existsSync(settings.bridgeNode)
          ? settings.bridgeNode
          : process.env.DSH_NODE || "";
      if (nodeExe && existsSync(nodeExe)) {
        bridgeProc = spawnDetached(nodeExe, ["src/bridge.js"], settings.bridgeDir, log, "桥接");
      } else if (lastPortWarn !== "bridge-node") {
        lastPortWarn = "bridge-node";
        log?.("桥接的 node 路径未配置（设置里的 bridgeNode）");
      }
    }
  }

  // 3. 端口同步
  syncBridgePort(settings, log);
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 启动守护；返回停止函数（只停守护，不停已经拉起的进程） */
export function startQQGuard(settings, log) {
  clearTimer();
  if (settings?.qqGuard === false) {
    log?.("QQ 守护已关闭");
    return () => clearTimer();
  }
  log?.("QQ 守护已启动（SnowLuma / 桥接）");
  tick(settings, log).catch(() => {});
  timer = setInterval(() => {
    tick(settings, log).catch(() => {});
  }, 60000);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimer();
}

/** 插件卸载时：停守护，并停掉由它拉起的进程 */
export function stopQQGuard() {
  clearTimer();
  for (const key of ["bridgeProc", "snowProc"]) {
    const proc = key === "bridgeProc" ? bridgeProc : snowProc;
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }
  bridgeProc = null;
  snowProc = null;
}
