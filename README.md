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
- **离线可用（像 App 一样）**：Service Worker 缓存页面外壳，音频与曲库清单永久存在本地，
  断网也能打开、切歌、看歌词。详见下面的「离线」一节。
- **永久缓存**：音频下载成 blob 存进 IndexedDB，曲库清单存 localStorage，**两者都不设过期时间**，
  只有你在缓存管理面板里手动删除才会清掉；面板能看占用空间、逐条删除、一键「全部缓存」（并发 3）
  与「全部删除」。
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

## 离线与缓存

断网不能打开网站了：**没有 Service Worker**。它以前负责预缓存页面外壳，但代价太大 ——
部署后旧外壳会继续吐旧 JS，而且「我现在看到的是不是最新版？」没法靠刷新回答。现在
页面外壳直接由 GitHub Pages 提供，一次普通请求就够快，不需要中间层。

留在浏览器里的只有**数据**，全部标 `NEVER_EXPIRES`，不手动清除就不清除：

- 音频 blob 存 IndexedDB（`lib/cache/indexedDb.js` + `components/Music/audioCache.js`）。
- 曲库清单存 localStorage（`components/Music/librarySource.js`）。
- 早期版本写入的带 TTL 的旧记录仍然按原过期时间处理，不会被意外「永久化」。

选 IndexedDB / localStorage 而不是 Cache API，是因为这里能被「缓存管理」面板统计、
逐条删除、一键清空 —— 你始终知道占了多少空间、能自己清掉。

> 已经访问过旧版本的浏览器里还装着那个 Service Worker，而且删掉 `sw.js` 并不会让它消失。
> `utils/retireServiceWorker.js` 会在加载时把它注销掉并清掉它留下的缓存。等旧外壳自然
> 淘汰完，这个文件就可以删了。它只做注销，永远不会再注册任何东西。

## 部署

推 `master` 会自动触发 `.github/workflows/deploy.yml`。

**Pages 的 Source 必须选 `GitHub Actions`**：仓库 Settings → Pages → Build and deployment →
Source 选 `GitHub Actions`，别留在「Deploy from a branch」。

留在分支模式的话，GitHub 会额外跑一次自己的 Jekyll 构建，并且发布的是**仓库根目录**而不是
`out/`，两个部署互相竞争，线上会**时好时坏**：一会儿正常，一会儿首页变成 Jekyll 渲染的
README、而 `/h5/`、`/desktop/` 全部 404。别因为刚推完看着正常就以为没事。

一次性确认方法：访问 `https://ianyspace.github.io/music/README.md`，如果能打开（200），
说明发布的是仓库根、也就是这个设置还没改对。

工作流在发布前会校验 `out/` 里的关键文件（三个页面、`.nojekyll`、`_next/static`），
缺任何一个都会直接让 CI 失败；同时会确认 `out/sw.js` **不存在** —— 因为它已经被有意移除，
再出现就说明又在发布旧外壳了。

## 快捷键 / 交互

| 位置 | 操作 |
| --- | --- |
| 列表右上角 🔍 | 展开搜索框，过滤当前曲库 |
| 列表右上角 ⋮ | 打开底部抽屉（云盘链接 / 缓存管理） |
| 播放详情页 | 点唱片切歌词，点歌词切回唱片 |
| 缓存管理 | 顶部 ⟳ 重新统计；每行 × 单独删除；底部两个按钮全量操作 |

## 许可

见 `LICENSE`。
