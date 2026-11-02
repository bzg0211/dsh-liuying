# dsh-liuying-voice

给 DeepSeek Harness 用的「流萤音色」语音插件。让 agent 用一段文字生成一条流萤声音的语音文件。

- 本地运行：**edge-tts**（普通女声）→ **RVC**（换成流萤音色）→ wav
- 不需要云 API，全部在本机完成

## 快速开始

装好、重启 DSH 后：

- agent 直接调 **`liuying_speak`**（说话）或 **`liuying_sing`**（唱歌）
- 或在 **设置 → 流萤语音** 里点「试听」，确认音色
- 默认音色是插件自带的 `models/liuying.pth`（500 轮官方语音版）

QQ 场景：跑 `scripts/watch-sing.py`（点歌）和 `scripts/voice-watch.py`（语音监听）。

## 页面朗读

- 每条助手回复旁有 **「朗读」**：点了用流萤音色读这条，再点停止
- 输入框左侧有 **「朗读」开关**：开了以后新回复会自动读（每条只读一次）
- 长消息自动分段（300 字一段，按标点断）、代码块和链接会被清洗掉
- 同一时间只播一条，点别的会自动打断
- 常驻 RVC 进程：模型只加载一次，第二条起约 2 秒出音；插件启动时会自动预热
- 生成的音频有缓存，同一条再点不会重复生成

- 只包含代码；**RVC 模型（.pth）需要你自己训练或准备**，本仓库不附带任何音色模型

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-liuying-voice
```

或本地开发：

```bash
# 在 profile 的 package.json 里
"dsh-liuying-voice": "link:D:/path/to/dsh-liuying-voice"
# bundles 里加 "dsh-liuying-voice"
```

重启 DSH 后，agent 会多一个工具 `liuying_speak`。

## 配置

设置存在 `$DSH_HOME/liuying-voice/settings.json`，字段：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `python` | 装有 edge-tts 和 RVC 环境的 python | `D:\\venv\\Scripts\\python.exe` |
| `ffmpeg` | ffmpeg 可执行文件 | `D:\\ffmpeg\\bin\\ffmpeg.exe` |
| `applio` | Applio 目录（RVC 推理入口 `core.py` 所在） | `D:\\Applio-main` |
| `model` | 你要用的 RVC 模型（.pth） | `D:\\models\\liuying.pth` |
| `index` | 对应 .index（可选，没有也能跑） | `D:\\models\\liuying.index` |
| `ttsVoice` | edge-tts 音色 | `zh-CN-XiaoxiaoNeural` |
| `ttsRate` | 语速（%） | `-8` |
| `pitch` | RVC 变调（半音） | `0` |
| `protect` | 辅音保护 | `0.33` |
| `indexRate` | index 影响 | `0.3` |
| `enabled` | 开关 | `true` |

## 音色模型

插件自带 `models/liuying.pth`：**500 轮，基于官方语音训练**（流萤全角色语音合集，官方配音）。

换模型：改设置里的 `model`（和可选的 `index`）指向你的 .pth 即可，不用改代码。

## 依赖

- Python 环境里装 `edge-tts`，以及能跑 Applio RVC 推理的依赖（torch 等）
- `ffmpeg`
- 一个 RVC 模型（.pth），按 [Applio](https://github.com/IAHispano/Applio) 的格式准备

## 工具

`liuying_speak`（说话）：

```json
{ "text": "晚安，开拓者。", "outPath": "可选" }
```

返回 `{ "path": "生成的 wav 路径", "bytes": 大小 }`。

`liuying_sing`（唱歌）：

```json
{ "song": "不眠之夜" }
```

流程：网易云搜索 → 下载 → demucs 分离 → RVC 换声 → 混音，返回 `{ "path", "bytes", "song" }`。耗时约 2~4 分钟。

## QQ 接入

`scripts/` 里有三个独立小工（需要 SnowLuma 的 OneBot 在跑，端口按你的配置）：

- `watch-sing.py`：群里发「唱XX」「点歌XX」→ 自动搜歌、换声、唱出来并发语音
- `voice-watch.py`：群里/私聊发「流萤说XX」「语音：XX」→ 用流萤音色说出来
- `speak-liuying.py`：合成脚本本体（被上面两个调用）

示例：

```bash
python scripts/watch-sing.py
python scripts/voice-watch.py
```

桥接侧的「文字 / 语音」发送比例会读本插件的 `sendMode` / `voiceRatio` 设置。

## 记忆资料

`memory/` 里是流萤的设定与剧情资料（firefly-lore / firefly-stories / penacony 系列），供人设使用时参考：

- `firefly-lore.md`：主设定
- `firefly-stories.md`：故事
- `penacony-*.md` 与 `raw/penacony/`：匹诺康尼剧情原文

这些是文本资料，插件本身不解析它们；它们用于给人设/记忆类插件读取。

## 说明

- 工具会 spawn python/ffmpeg 子进程，因此需要设置里的路径在本机存在。
- 只接受短文本（300 字以内）。
- 生成的文件默认放在插件目录的 `out/` 下，可用 `outDir` 改。

## License

MIT。音色模型（.pth）及相关素材的版权归各自作者，使用者自行负责。
