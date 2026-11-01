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
      { key: "voiceRatio", label: "混合时语音比例（0~1）", type: "number", min: 0, max: 1, step: 0.1 },
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
                value: settings[f.key] ?? 0.5,
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
      }
    }

    return { name: "dsh-liuying-voice", inject: ["slots"], apply };
  },
});
