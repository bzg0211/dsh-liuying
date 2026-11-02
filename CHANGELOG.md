# Changelog

## 0.1.1

- 设置页：新增「试听」按钮（/liuying-voice/test）
- 新增记忆浏览页（/liuying-voice/memory，可搜索/查看）
- 默认音色：插件自带 models/liuying.pth（500 轮官方语音版），开箱即用
- 发送方式：sendMode / voiceRatio（文字/语音/混合），桥接会读取

## 0.1.0

- 初始版本
- `liuying_speak`：文字 → edge-tts → RVC → 流萤音色 wav
- `liuying_sing`：歌名 → 网易云搜索/下载 → demucs 分离 → RVC 换声 → 混音 → wav
- 设置页、scripts/（watch-sing / voice-watch / speak-liuying）、memory/