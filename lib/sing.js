/**
 * dsh-liuying-voice — 唱歌流水线。
 *
 * 歌名 -> 网易云搜索/下载 -> demucs 分离 -> RVC 音色转换 -> ffmpeg 混音 -> wav。
 * 所有外部程序路径来自设置。
 */
import { spawn } from "node:child_process";

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://music.163.com/",
};

function run(cmd, args, { cwd, env, timeoutMs = 600000 } = {}) {
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
      reject(new Error(`超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out).slice(-500)));
    });
  });
}

async function jsonGet(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 网易云搜索，返回最佳匹配。 */
export async function searchSong(name) {
  const q = encodeURIComponent(name);
  const url = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${q}&type=1&offset=0&total=true&limit=8`;
  const data = await jsonGet(url);
  const songs = data?.result?.songs ?? [];
  if (!songs.length) throw new Error(`找不到歌曲：${name}`);
  const norm = (x) =>
    String(x ?? "")
      .replace(/[（）()【】[\]《》\s·]/g, "")
      .toLowerCase();
  const target = norm(String(name).replace(/[《》]/g, ""));
  const exact = songs.find((s) => norm(s.name) === target);
  if (exact) return exact;
  const partial = songs.find((s) => target && norm(s.name).includes(target));
  return partial ?? songs[0];
}

/** 下载到 mp3。 */
export async function download(song, outMp3, ua = UA) {
  const url = `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;
  const res = await fetch(url, { headers: ua, redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200 * 1024) throw new Error(`下载内容过小（${buf.length} bytes），可能是试听片段`);
  mkdirSync(path.dirname(outMp3), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outMp3, buf);
  return { bytes: buf.length };
}

/** 歌名归一化：忽略括号、空格、标点 */
function normName(x) {
  return String(x ?? "")
    .replace(/[（）()【】[\]《》\s·]/g, "")
    .toLowerCase();
}

/** 在缓存目录里按歌名找已经分离好的伴奏/人声 */
function findCachedSong(cacheRoot, name) {
  try {
    if (!existsSync(cacheRoot)) return null;
    const target = normName(name);
    if (!target) return null;
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(cacheRoot, entry.name);
      const metaPath = path.join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf8"));
      } catch {
        continue;
      }
      const cachedName = normName(meta?.name);
      if (!cachedName) continue;
      const hit = cachedName === target || cachedName.includes(target) || target.includes(cachedName);
      if (!hit) continue;
      const vocals = path.join(dir, "vocals.wav");
      const accomp = path.join(dir, "no_vocals.wav");
      if (existsSync(vocals) && existsSync(accomp)) {
        return { id: entry.name, name: meta.name, vocals, accomp };
      }
    }
  } catch {}
  return null;
}

/**
 * 完整唱歌流程。
 * @returns {Promise<{path:string, bytes:number, song:string}>}
 */
export async function sing(songName, settings, opts = {}) {
  const python = settings.python;
  const ffmpeg = settings.ffmpeg;
  const applio = settings.applio;
  const model = settings.model;
  if (!python || !ffmpeg || !applio || !model) throw new Error("缺少配置：python/ffmpeg/applio/model");

  const workDir = opts.workDir || path.join(settings.outDir || path.join(path.dirname(process.cwd()), "out"), "sing");
  mkdirSync(workDir, { recursive: true });
  const stamp = `${Date.now()}`;
  const mp3 = path.join(workDir, `song-${stamp}.mp3`);
  const sepDir = path.join(workDir, `sep-${stamp}`);

  const cacheRoot = path.join(settings.outDir || path.join(workDir, ".."), "sing-cache");

  // 先按歌名找缓存：断网也能复唱已经唱过的歌
  let song = null;
  let vocals = null;
  let accomp = null;
  const cached = findCachedSong(cacheRoot, songName);
  if (cached) {
    song = { id: cached.id, name: cached.name };
    vocals = cached.vocals;
    accomp = cached.accomp;
  } else {
    song = await searchSong(songName);
    const songCache = path.join(cacheRoot, String(song.id));
    const cachedVocals = path.join(songCache, "vocals.wav");
    const cachedAccomp = path.join(songCache, "no_vocals.wav");
    if (existsSync(cachedVocals) && existsSync(cachedAccomp)) {
      vocals = cachedVocals;
      accomp = cachedAccomp;
    } else {
      await download(song, mp3);
      // demucs 分离（venv python -m demucs）
      await run(python, ["-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", sepDir, mp3], {
        env: { TORCH_HOME: settings.torchHome || "", OMP_NUM_THREADS: "4" },
        timeoutMs: 600000,
      });
      const stemDir = path.join(sepDir, "htdemucs", path.basename(mp3, ".mp3"));
      mkdirSync(songCache, { recursive: true });
      copyFileSync(path.join(stemDir, "vocals.wav"), cachedVocals);
      copyFileSync(path.join(stemDir, "no_vocals.wav"), cachedAccomp);
      writeFileSync(
        path.join(songCache, "meta.json"),
        JSON.stringify({ id: song.id, name: song.name }),
        "utf8",
      );
      vocals = cachedVocals;
      accomp = cachedAccomp;
    }
  }

  // RVC 换声：优先常驻进程（模型已加载），失败再走命令行
  const rvcOut = path.join(workDir, `rvc-${stamp}.wav`);
  const rvcEnv = {
    APPLIO_CONFIG_FILE: path.join(applio, "..", "applio-config.json"),
    APPLIO_LOGS_DIR: path.join(applio, "..", "applio-logs"),
    OMP_NUM_THREADS: "4",
    PYTHONIOENCODING: "utf-8",
  };
  const cliInfer = () =>
    run(
      python,
      ["core.py", "infer", "--input-path", vocals, "--output-path", rvcOut,
       "--pth-path", model, "--index-path", settings.index || path.join(path.dirname(model), "liuying.index"),
       "--pitch", String(settings.pitch ?? 0), "--protect", String(settings.protect ?? 0.33),
       "--index-rate", String(settings.indexRate ?? 0.3), "--f0-method", settings.f0Method || "rmvpe"],
      { cwd: applio, env: rvcEnv, timeoutMs: 900000 },
    );

  // 整首歌用命令行更稳（常驻进程适合短句，长音频容易卡）
  await cliInfer();

  // 混音：人声 1.0 + 伴奏 0.8
  const finalPath = path.join(workDir, `final-${stamp}.wav`);
  await run(ffmpeg, [
    "-y",
    "-i", rvcOut,
    "-i", accomp,
    "-filter_complex", "[0:a]volume=1.0[v];[1:a]volume=0.8[a];[v][a]amix=inputs=2:duration=longest[out]",
    "-map", "[out]",
    finalPath,
  ], { timeoutMs: 300000 });

  // 清理中间文件
  for (const f of [mp3]) {
    try {
      rmSync(f, { force: true });
    } catch {}
  }
  const bytes = statSync(finalPath).size;
  if (bytes < 10 * 1024) throw new Error("混音结果过小");
  return { path: finalPath, bytes, song: song.name };
}
