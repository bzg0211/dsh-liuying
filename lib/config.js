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
  const next = { ...DEFAULTS, ...saved, ...patch };
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
    outDir: pick(settings.outDir),
  };
}
