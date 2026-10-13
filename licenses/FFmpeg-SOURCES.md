# FFmpeg 运行时与源代码获取

DeskIsland 1.3.0 使用未经修改的 `ffmpeg.exe`，来自 Gyan 6.1.1 essentials Windows x64 静态构建，作为独立进程执行 MP3 编码。

- FFmpeg 版本：6.1.1。
- 编译器：GCC 12.2.0，MSYS2。
- 二进制 SHA-256：`04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`。
- 许可证：GPL v3 或后续版本；完整文本见同目录 `GPL-3.0.txt`。
- 原始构建与附带说明：https://github.com/GyanD/codexffmpeg/releases/tag/6.1.1
- 构建提供方：https://www.gyan.dev/ffmpeg/builds/
- FFmpeg 6.1.1 源代码：https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz
- FFmpeg 6.1.1 源代码镜像：https://github.com/FFmpeg/FFmpeg/tree/n6.1.1
- LAME 源代码与项目说明：https://lame.sourceforge.io/

原始构建归档包含其 README 与许可说明；README 列出所用外部库版本。获取或重建该完整构建时，应一并获取其中列出的外部库源代码及各自许可，不能将完整静态构建视为只有 FFmpeg 本体。

可运行 `ffmpeg.exe -version`、`ffmpeg.exe -buildconf` 和 `ffmpeg.exe -L` 查看未经删除的版本、完整编译配置及许可说明。DeskIsland 不修改 FFmpeg 二进制，也不要求使用系统 PATH 中的 FFmpeg。
