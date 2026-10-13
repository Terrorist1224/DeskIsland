# 音频控制第三方组件

音频开发运行时位于 `.tmp/audio-runtime/`；1.3.0 安装包中的运行时位于 `resources/app/audio-runtime/`。二进制只随安装包分发，不提交到源码仓库。

## NAudio 2.2.1

使用 NAudio.Core、NAudio.Wasapi 的 netstandard2.0 模块。
来源：https://github.com/naudio/NAudio/tree/v2.2.1

Copyright 2020 Mark Heath

## AudioDeviceCmdlets

`src/main/audio/AudioHost.cs` 中的 Windows PolicyConfig COM 接口声明参考此项目。
来源：https://github.com/frgnca/AudioDeviceCmdlets

Copyright (c) 2016-2022 Francois Gendron <fg@frgn.ca>

上述两项采用 MIT License：

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## FFmpeg 6.1.1 essentials / libmp3lame

使用未经修改的 Gyan 6.1.1 essentials 静态构建，作为独立命令行进程执行 MP3 编码。
该构建启用了 GPL、version3，采用 GPL v3 或后续版本，不标为 MIT。

- 构建来源：https://www.gyan.dev/ffmpeg/builds/
- FFmpeg 6.1.1 源代码：https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz
- FFmpeg 许可说明：https://ffmpeg.org/legal.html
- GNU GPL v3：https://www.gnu.org/licenses/gpl-3.0.html
- LAME：https://lame.sourceforge.io/

安装包附带 `audio-runtime/licenses/GPL-3.0.txt` 许可全文与 `audio-runtime/licenses/FFmpeg-SOURCES.md` 源代码获取说明。FFmpeg 保留其版权、许可与构建配置，NAudio 与 AudioDeviceCmdlets 保留上方 MIT 声明。
