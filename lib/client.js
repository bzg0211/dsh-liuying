/**
 * dsh-liuying-voice client：设置页。
 * 运行时格式与 DSH client 插件一致（__ModuleLoader__.load + require("react")）。
 */
window.__ModuleLoader__.load({
  id: "dsh-liuying-voice",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const FIELD_DEFS = [
      { key: "enabled", label: "启用", type: "boolean" },
      { key: "sendMode", label: "发送方式（QQ）", type: "select", options: [["mix", "文字+语音混合"], ["text", "只发文字"], ["voice", "只发语音"]] },
      { key: "voiceRatio", label: "混合时语音比例（0~1）", type: "number", min: 0, max: 1, step: 0.1, default: 0.5 },
      { key: "ttsRate", label: "语速（-50~50，默认 -8）", type: "number", min: -50, max: 50, step: 1, default: -8 },
      { key: "pitch", label: "变调（半音，0 为原调）", type: "number", min: -12, max: 12, step: 1, default: 0 },
      { key: "protect", label: "辅音保护（0~0.5，默认 0.33）", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.33 },
      { key: "python", label: "Python 路径（装 edge-tts / RVC 环境）", type: "text", placeholder: "D:\\venv\\Scripts\\python.exe" },
      { key: "ffmpeg", label: "ffmpeg 路径", type: "text", placeholder: "D:\\ffmpeg\\bin\\ffmpeg.exe" },
      { key: "applio", label: "Applio 目录（core.py 所在）", type: "text", placeholder: "D:\\Applio-main" },
      { key: "model", label: "RVC 模型（.pth）", type: "text", placeholder: "D:\\models\\liuying.pth" },
      { key: "index", label: "索引文件（.index，可选）", type: "text", placeholder: "D:\\models\\liuying.index" },
      { key: "ttsVoice", label: "edge-tts 音色", type: "text", placeholder: "zh-CN-XiaoxiaoNeural" },
      { key: "outDir", label: "输出目录", type: "text", placeholder: "（默认插件目录下 out/）" },
    ];

    const API = "/liuying-voice/settings";

    async function load() {
      const res = await fetch(API, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`读取设置失败：${res.status}`);
      return res.json();
    }

    async function save(patch) {
      const res = await fetch(API, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || `保存失败：${res.status}`);
      return body.settings;
    }

    function SettingsPage() {
      const [settings, setSettings] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [savedAt, setSavedAt] = React.useState(0);
      const [saving, setSaving] = React.useState(false);
      const [testing, setTesting] = React.useState(false);
      const [testMsg, setTestMsg] = React.useState("");
      const [autoPlay, setAutoPlay] = React.useState(() => autoStore.get());
      React.useEffect(() => autoStore.subscribe(() => setAutoPlay(autoStore.get())), []);

      React.useEffect(() => {
        let alive = true;
        load()
          .then((s) => {
            if (alive) setSettings(s);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
        return () => {
          alive = false;
        };
      }, []);

      const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

      const onSave = async () => {
        if (!settings) return;
        setSaving(true);
        setError(null);
        try {
          const next = await save(settings);
          setSettings(next);
          setSavedAt(Date.now());
        } catch (e) {
          setError(e.message);
        } finally {
          setSaving(false);
        }
      };

      const onTest = async () => {
        setTesting(true);
        setError(null);
        setTestMsg("");
        try {
          const res = await fetch("/liuying-voice/test", { method: "POST", credentials: "same-origin" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error(body.error || `失败：${res.status}`);
          setTestMsg(`已生成：${body.path}`);
        } catch (e) {
          setError(e.message);
        } finally {
          setTesting(false);
        }
      };

      if (!settings) {
        return h("div", { style: { padding: 16, color: "var(--dsh-text-secondary, #888)" } }, error ? `加载失败：${error}` : "加载中…");
      }

      return h(
        "div",
        { style: { display: "grid", gap: 12, padding: 4 } },
        h(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          h("input", {
            type: "checkbox",
            checked: autoPlay,
            onChange: (e) => {
              autoStore.set(e.target.checked);
            },
          }),
          "自动朗读新回复",
        ),
        ...FIELD_DEFS.map((f) => {
          if (f.type === "boolean") {
            return h(
              "label",
              { key: f.key, style: { display: "flex", alignItems: "center", gap: 8 } },
              h("input", {
                type: "checkbox",
                checked: settings[f.key] !== false,
                onChange: (e) => update(f.key, e.target.checked),
              }),
              f.label,
            );
          }
          if (f.type === "select") {
            return h(
              "label",
              { key: f.key, style: { display: "grid", gap: 4 } },
              h("span", { style: { fontSize: 13, opacity: 0.8 } }, f.label),
              h(
                "select",
                {
                  value: settings[f.key] ?? f.options[0][0],
                  onChange: (e) => update(f.key, e.target.value),
                  style: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #555)", background: "transparent", color: "inherit" },
                },
                ...f.options.map(([v, t]) => h("option", { key: v, value: v }, t)),
              ),
            );
          }
          if (f.type === "number") {
            return h(
              "label",
              { key: f.key, style: { display: "grid", gap: 4 } },
              h("span", { style: { fontSize: 13, opacity: 0.8 } }, f.label),
              h("input", {
                type: "number",
                min: f.min,
                max: f.max,
                step: f.step,
                value: settings[f.key] ?? f.default ?? 0,
                onChange: (e) => update(f.key, Number(e.target.value)),
                style: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #555)", background: "transparent", color: "inherit" },
              }),
            );
          }
          return h(
            "label",
            { key: f.key, style: { display: "grid", gap: 4 } },
            h("span", { style: { fontSize: 13, opacity: 0.8 } }, f.label),
            h("input", {
              type: "text",
              value: settings[f.key] ?? "",
              placeholder: f.placeholder ?? "",
              onChange: (e) => update(f.key, e.target.value),
              style: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #555)", background: "transparent", color: "inherit" },
            }),
          );
        }),
        h(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center" } },
          h(
            "button",
            {
              onClick: onSave,
              disabled: saving,
              style: { padding: "6px 14px", borderRadius: 6, cursor: "pointer" },
            },
            saving ? "保存中…" : "保存",
          ),
          h("button", {
            onClick: onTest,
            disabled: testing,
            style: { padding: "6px 14px", borderRadius: 6, cursor: "pointer" },
          }, testing ? "生成中…" : "试听"),
          savedAt ? h("span", { style: { fontSize: 12, opacity: 0.7 } }, "已保存") : null,
          testMsg ? h("span", { style: { fontSize: 12, opacity: 0.8 } }, testMsg) : null,
          error ? h("span", { style: { fontSize: 12, color: "#e66" } }, error) : null,
        ),
      );
    }

    const AUTO_KEY = "liuying-voice:autoPlay";

    function isAutoPlay() {
      try {
        return localStorage.getItem(AUTO_KEY) === "1";
      } catch {
        return false;
      }
    }

    /** 自动朗读开关的共享状态（输入框按钮与朗读按钮共用） */
    const autoStore = (() => {
      let enabled = isAutoPlay();
      const listeners = new Set();
      return {
        get: () => enabled,
        set: (v) => {
          enabled = !!v;
          try {
            localStorage.setItem(AUTO_KEY, enabled ? "1" : "0");
          } catch {}
          for (const l of listeners) {
            try {
              l();
            } catch {}
          }
        },
        subscribe: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      };
    })();

    /** 输入框左侧的「自动朗读」开关 */
    function AutoPlayToggle(props) {
      const enabled =
        props?.autoPlayEnabled && props?.subscribeAutoPlay
          ? React.useSyncExternalStore(props.subscribeAutoPlay, props.autoPlayEnabled, () => autoStore.get())
          : autoStore.get();
      const toggle = () => {
        const next = !enabled;
        if (props?.setAutoPlay) props.setAutoPlay(next);
        else autoStore.set(next);
      };
      return h(
        "button",
        {
          onClick: toggle,
          title: enabled ? "自动朗读：开（新回复会读出来）" : "自动朗读：关",
          style: {
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 999,
            cursor: "pointer",
            border: "1px solid var(--dsh-border, #555)",
            background: enabled ? "rgba(255,160,60,0.18)" : "transparent",
            color: "inherit",
          },
        },
        enabled ? "朗读 · 开" : "朗读",
      );
    }

    function splitForSpeak(text, limit = 300) {
      const t = String(text ?? "").replace(/\s*\n\s*/g, " ").trim();
      if (!t) return [];
      if (t.length <= limit) return [t];
      const out = [];
      let rest = t;
      const strong = "。！？!?；;…";
      while (rest.length > limit) {
        let cut = -1;
        for (let i = limit; i > Math.floor(limit * 0.6); i--) {
          if (strong.includes(rest[i])) {
            cut = i + 1;
            break;
          }
        }
        if (cut < 0) {
          for (let i = limit; i > Math.floor(limit * 0.6); i--) {
            if (rest[i] === "，" || rest[i] === ",") {
              cut = i + 1;
              break;
            }
          }
        }
        if (cut < 0) cut = limit;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
      return out.filter(Boolean);
    }

    const SPEAK_CACHE = new Map(); // 文本 -> blob url（点过一次就不再生成）
    const AUTO_PLAYED = new Set(); // 已自动朗读过的 messageId

    async function fetchSpeechUrl(text) {
      const hit = SPEAK_CACHE.get(text);
      if (hit) return hit;
      const res = await fetch("/liuying-voice/speak", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `失败：${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      SPEAK_CACHE.set(text, url);
      if (SPEAK_CACHE.size > 40) {
        const first = SPEAK_CACHE.keys().next().value;
        const old = SPEAK_CACHE.get(first);
        SPEAK_CACHE.delete(first);
        try {
          URL.revokeObjectURL(old);
        } catch {}
      }
      return url;
    }

    /** 最新一条助手消息的 id */
    function latestAssistantId(snapshot) {
      let best = null;
      for (const node of snapshot?.nodes ?? []) {
        if (node.kind !== "assistant" || !node.messageId) continue;
        const order = [node.turn ?? 0, node.step ?? 0, node.seq ?? 0];
        const newer =
          !best ||
          order[0] > best.order[0] ||
          (order[0] === best.order[0] && order[1] > best.order[1]) ||
          (order[0] === best.order[0] && order[1] === best.order[1] && order[2] > best.order[2]);
        if (newer) best = { order, id: node.messageId };
      }
      return best?.id ?? null;
    }

    function selectAssistantText(snapshot, messageId) {
      for (const node of snapshot?.nodes ?? []) {
        if (node.kind !== "assistant" || node.messageId !== messageId) continue;
        return (node.blocks ?? [])
          .filter((b) => b.kind === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n");
      }
      return "";
    }

    /** 朗读前清洗：去掉代码块、链接、markdown 符号，读起来更像人话 */
    function cleanForSpeak(text) {
      return String(text ?? "")
        .replace(/```[\s\S]*?```/g, "（这里是一段代码）")
        .replace(/`[^`]*`/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "链接")
        .replace(/^\s*#{1,6}\s*/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/[*_~>|]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    /** 全局同一时间只允许一条在播 */
    const GLOBAL_PLAYER = { stop: null };

    /** 助手消息旁的「朗读」按钮：调 /liuying-voice/speak 用流萤音色读出来 */
    function SpeakActions(props) {
      const { messageId, useChat } = props;
      const text = useChat
        ? useChat((s) => selectAssistantText({ nodes: s.legacy?.nodes ?? s.nodes ?? [] }, messageId))
        : "";
      const isLatest = useChat
        ? useChat((s) => latestAssistantId({ nodes: s.legacy?.nodes ?? s.nodes ?? [] })) === messageId
        : false;
      const [status, setStatus] = React.useState("idle"); // idle | loading | playing
      const [progress, setProgress] = React.useState({ cur: 0, total: 0 });
      const [err, setErr] = React.useState("");
      const audioRef = React.useRef(null);
      const tokenRef = React.useRef(0);
      const stopRef = React.useRef(null);

      React.useEffect(
        () => () => {
          tokenRef.current++;
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }
          if (stopRef.current && GLOBAL_PLAYER.stop === stopRef.current) GLOBAL_PLAYER.stop = null;
        },
        [],
      );

      const stop = React.useCallback(() => {
        tokenRef.current++;
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        if (GLOBAL_PLAYER.stop === stop) GLOBAL_PLAYER.stop = null;
        setStatus("idle");
      }, []);
      stopRef.current = stop;

      const start = React.useCallback(async (source) => {
        const spoken = cleanForSpeak(source);
        const segs = splitForSpeak(spoken);
        if (!segs.length) return;
        // 打断上一条
        if (GLOBAL_PLAYER.stop) {
          try {
            GLOBAL_PLAYER.stop();
          } catch {}
        }
        GLOBAL_PLAYER.stop = stop;
        const token = ++tokenRef.current;
        setErr("");
        setStatus("loading");
        setProgress({ cur: 0, total: segs.length });
        try {
          let first = true;
          for (let i = 0; i < segs.length; i++) {
            if (token !== tokenRef.current) return;
            const url = await fetchSpeechUrl(segs[i]);
            if (token !== tokenRef.current) return;
            if (first) {
              first = false;
              setStatus("playing");
            }
            setProgress({ cur: i + 1, total: segs.length });
            // 播这一段的时候，后台先把下一段生成好
            if (i + 1 < segs.length) fetchSpeechUrl(segs[i + 1]).catch(() => {});
            const audio = new Audio(url);
            audioRef.current = audio;
            await new Promise((resolve, reject) => {
              audio.onended = resolve;
              audio.onerror = () => reject(new Error("播放失败"));
              audio.play().catch(reject);
            });
            if (token !== tokenRef.current) return;
          }
          if (GLOBAL_PLAYER.stop === stop) GLOBAL_PLAYER.stop = null;
          setStatus("idle");
        } catch (e) {
          if (token === tokenRef.current) {
            setStatus("idle");
            setErr(e?.message || String(e));
          }
        }
      }, []);

      // 自动朗读开关（与输入框的开关、设置页同步）
      const autoOn =
        props?.autoPlayEnabled && props?.subscribeAutoPlay
          ? React.useSyncExternalStore(props.subscribeAutoPlay, props.autoPlayEnabled, () => autoStore.get())
          : autoStore.get();

      // 自动朗读：开启后，最新一条助手回复自动读出来（每条只读一次）
      React.useEffect(() => {
        if (!isLatest || !autoOn) return;
        if (!text || !text.trim()) return;
        if (AUTO_PLAYED.has(messageId)) return;
        AUTO_PLAYED.add(messageId);
        start(text);
      }, [isLatest, autoOn, text, messageId, start]);

      if (!text || !text.trim()) return null;

      const onClick = () => {
        if (status === "playing" || status === "loading") {
          stop();
          return;
        }
        start(text);
      };

      // 鼠标移到按钮上就先开始生成，点下去时通常已经有音频了
      const warm = () => {
        if (status !== "idle") return;
        const segs = splitForSpeak(cleanForSpeak(text));
        segs.slice(0, 2).forEach((seg) => fetchSpeechUrl(seg).catch(() => {}));
      };

      const label =
        status === "loading"
          ? "生成中…"
          : status === "playing"
            ? progress.total > 1
              ? `停止 ${progress.cur}/${progress.total}`
              : "停止"
            : "朗读";

      return h(
        "button",
        {
          onClick,
          onMouseEnter: warm,
          onFocus: warm,
          title: err || "用流萤的声音读这条",
          style: {
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 6,
            cursor: "pointer",
            color: err ? "#e66" : "inherit",
          },
        },
        err ? "朗读失败" : label,
      );
    }

    function apply(ctx) {
      const mount = () => {
        if (!ctx.slots?.register) return;
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "liuying-voice",
            order: 55,
            label: () => "流萤语音",
          },
          SettingsPage,
        );
      };
      let dispose = null;
      if (ctx.slots?.inject) {
        ctx.slots.inject("settings.section", () => {
          dispose = mount();
          return () => {
            if (typeof dispose === "function") dispose();
            dispose = null;
          };
        });

        ctx.slots.inject("conversation.chat.assistant-actions", () => {
          if (!ctx.slots?.register) return () => {};
          return ctx.slots.register(
            {
              name: "conversation.chat.assistant-actions",
              id: "liuying-voice-speak",
              inject: () => ({
                autoPlayEnabled: () => autoStore.get(),
                subscribeAutoPlay: (l) => autoStore.subscribe(l),
              }),
            },
            SpeakActions,
          );
        });

        // 输入框左侧：自动朗读开关（像 fish-tts 那样随手可开）
        ctx.slots.inject("conversation.input.left", () => {
          if (!ctx.slots?.register) return () => {};
          return ctx.slots.register(
            {
              name: "conversation.input.left",
              id: "liuying-voice-autoplay",
              order: 30,
              inject: () => ({
                autoPlayEnabled: () => autoStore.get(),
                setAutoPlay: (v) => autoStore.set(v),
                subscribeAutoPlay: (l) => autoStore.subscribe(l),
              }),
            },
            AutoPlayToggle,
          );
        });
      }
    }

    return { name: "dsh-liuying-voice", inject: ["slots"], apply };
  },
});
