/** 基础测试：设置合并与描述逻辑（不依赖网络/子进程）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, resolveSettings } from "../lib/speak.js";
import { describeSettings } from "../lib/config.js";

test("resolveSettings 合并默认值", () => {
  const s = resolveSettings({ python: "C:\\py.exe", voiceRatio: 0.3 });
  assert.equal(s.python, "C:\\py.exe");
  assert.equal(s.voiceRatio, 0.3);
  assert.equal(s.sendMode, DEFAULTS.sendMode);
  assert.ok(s.outDir.length > 0);
});

test("describeSettings 归一化 sendMode / voiceRatio", () => {
  const d = describeSettings({ sendMode: "voice", voiceRatio: 2 });
  assert.equal(d.sendMode, "voice");
  assert.equal(d.voiceRatio, 1);

  const d2 = describeSettings({ sendMode: "bogus", voiceRatio: -1 });
  assert.equal(d2.sendMode, "mix");
  assert.equal(d2.voiceRatio, 0);
});

test("describeSettings 不泄露未声明字段", () => {
  const d = describeSettings({ python: "x", secret: "nope" });
  assert.equal(d.python, "x");
  assert.equal("secret" in d, false);
});
