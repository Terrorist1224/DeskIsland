# 音乐读取与歌词参考

- [Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper)：Apache-2.0。现有 QQ 歌词请求流程的参考来源；许可证保留在本目录。

当前只适配 QQ 音乐系统媒体会话。浏览器和网易云不会成为读取或控制目标，无 QQ 会话时显示黑胶空状态并禁用控制。

歌词使用 QQ 按句歌词，失败回退 LRCLIB；匹配校验歌名、歌手、时长并优先同专辑。统一使用原生 Web Animations 连续滚动，不提供逐字双色高亮。歌词版权属于原权利方。

网易云再次调研：[InfLink-rs](https://github.com/apoint123/inflink-rs) 文档列出 3.1.20 至 3.1.41 版本，需要安装 BetterNCM、客户端插件并重启网易云。本轮没有修改外部客户端；按用户条件先收敛 QQ。[TaskbarLyrics 的进度问题](https://github.com/ANYNC/TaskbarLyrics/issues/44)也讨论了插件与内存读取方案。此前的标题降级和逐字请求通路已移除。

验证命令：`npm test`、`npm run typecheck`、`npm run build`；Windows 交互验证使用 `start-test.cmd`。当前滚动测量和截图在 `.tmp/smooth-lyrics/`，旧 `.tmp/music-weather/` 为历史初稿和报告，不能作为当前兼容性说明。
