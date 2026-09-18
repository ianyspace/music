# Music Space

一个独立的静态音乐播放器：Next.js 15（Pages Router）+ Sass，构建为纯静态站点发布到
GitHub Pages —— https://ianyspace.github.io/music/

代码从博客仓库 `space` 的音乐模块整体切出（`components/Music/` + `pages/music/`），
播放逻辑未改动，只把博客专有的部分替换掉了（详见 `AGENTS.md` 的「迁移时替换了什么」）。

## 特性

- **两种布局**：窄屏 `/h5`（列表 + 迷你条 + 全屏播放页），宽屏 `/desktop`（列表 + 歌词工作台，
  三处 Liquid Glass 表面）。`/` 按 900px 断点自动跳转，两套布局共用同一份播放状态。
- **两套曲库**：默认走公共 Cloudflare R2 桶（**完全不需要授权**）；连接自己的 Google 云盘后
  切换成自己的文件夹，断开则回落到公共曲库。
- **离线缓存**：音频下载成 blob 存进 IndexedDB，TTL 7 天；缓存管理面板能看占用空间、
  逐条删除、一键「全部缓存」（并发 3）与「全部删除」。
- **歌词**：读取同名 `.lrc` / `.txt`，支持逐行滚动与纯文本模式。
- **播放器细节**：单例 `<audio>`（切页面不中断）、随机 / 单曲 / 列表循环、预取下一首
  （iOS 后台续播）、Media Session 锁屏控制、无音量控件（交给系统）。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # 静态产物在 out/
```

## 曲库从哪来

默认直接连已部署的 Worker（`config/index.js` 的 `music.workerUrl`）：

```
GET https://space-music.ianyscript.workers.dev/tracks
```

换成自己的 R2 桶 / Worker 就改这个值，或用环境变量 `NEXT_PUBLIC_MUSIC_WORKER_URL` 覆盖。
Worker 源码在 `cloudflare-worker/`，部署方式见 `cloudflare-worker/README.md`。

> 上传新歌后想立即看到，请求带 `?refresh=1`，或等清单缓存（300 秒）过期。

## 连接自己的 Google 云盘

播放页「更多」抽屉 → 「谷歌云盘链接」，填入自己的 OAuth Client ID（`drive.readonly`，
只需一次，存在 localStorage）。公共曲库不需要任何授权，所以不填也能正常播放。

## 部署

推 `master` 会自动触发 `.github/workflows/deploy.yml`。

**首次需要手动开一次 Pages**：仓库 Settings → Pages → Build and deployment →
Source 选 `GitHub Actions`。

## 快捷键 / 交互

| 位置 | 操作 |
| --- | --- |
| 列表右上角 🔍 | 展开搜索框，过滤当前曲库 |
| 列表右上角 ⋮ | 打开底部抽屉（云盘链接 / 缓存管理） |
| 播放详情页 | 点唱片切歌词，点歌词切回唱片 |
| 缓存管理 | 顶部 ⟳ 重新统计；每行 × 单独删除；底部两个按钮全量操作 |

## 许可

见 `LICENSE`。
