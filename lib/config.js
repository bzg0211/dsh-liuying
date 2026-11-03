/** 设置存储：$DSH_HOME/liuying-voice/settings.json（无敏感值）。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULTS, resolveSettings } from "./speak.js";

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

export function stateDir() {
  const dir = path.join(dshHome(), "liuying-voice");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function settingsFile() {
  return path.join(stateDir(), "settings.json");
}

export function loadSettings() {
  const file = settingsFile();
  let saved = {};
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      saved = {};
    }
  }
  return { saved, settings: resolveSettings(saved) };
}

export function saveSettings(patch = {}) {
  const { saved } = loadSettings();
  // 只接受已知字段，避免把乱七八糟的东西写进设置文件
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  const next = { ...DEFAULTS, ...saved, ...clean };
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return resolveSettings(next);
}

export function describeSettings(settings) {
  const pick = (v) => (v ? String(v) : "");
  return {
    enabled: settings.enabled !== false,
    sendMode: settings.sendMode === "voice" || settings.sendMode === "text" ? settings.sendMode : "mix",
    voiceRatio: Number.isFinite(Number(settings.voiceRatio)) ? Math.min(1, Math.max(0, Number(settings.voiceRatio))) : 0.5,
    python: pick(settings.python),
    ffmpeg: pick(settings.ffmpeg),
    applio: pick(settings.applio),
    model: pick(settings.model),
    index: pick(settings.index),
    ttsVoice: pick(settings.ttsVoice),
    ttsRate: Number.isFinite(Number(settings.ttsRate)) ? Math.min(50, Math.max(-50, Number(settings.ttsRate))) : -8,
    pitch: Number.isFinite(Number(settings.pitch)) ? Math.min(12, Math.max(-12, Number(settings.pitch))) : 0,
    protect: Number.isFinite(Number(settings.protect)) ? Math.min(0.5, Math.max(0, Number(settings.protect))) : 0.33,
    outDir: pick(settings.outDir),
    qqGuard: settings.qqGuard !== false,
    snowLumaDir: pick(settings.snowLumaDir),
    snowLumaNode: pick(settings.snowLumaNode),
    bridgeDir: pick(settings.bridgeDir),
    bridgeNode: pick(settings.bridgeNode),
  };
}
