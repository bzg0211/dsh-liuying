# Changelog

## 0.1.5

- 朗读按钮：图标 + 播放高亮 + 失败可「重试朗读」+ 固定宽度不跳动
- 悬停预生成延迟 300ms 并取消：扫过很多消息不会再触发一堆请求
- 没有可读文字的消息给出提示，而不是无反应

## 0.1.4

- TTS 也搬进常驻进程，省掉每次启动 python
- RVC 直接吃 mp3，跳过 ffmpeg 转码
- 服务端 wav 缓存（按文字+参数哈希），刷新页面后同一条秒回
- 鼠标悬停「朗读」即开始预生成，点下去基本即时

## 0.1.3

- 常驻 RVC 推理进程（lib/rvc-worker.py）：模型只加载一次，第二次起约 1.8 秒出音（原 12 秒）
- 插件启动后自动预热，首次朗读不必等加载
- 长消息朗读时后台预生成下一段，播放不中断
- worker 异常自动回退到命令行模式

## 0.1.2

- 页面朗读：消息旁「朗读」按钮 + 输入框自动朗读开关
- 朗读分段（300 字）、文本清洗（代码块/链接/markdown）、播放进度
- 全局单播放器（点别的自动打断）、同文本缓存

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