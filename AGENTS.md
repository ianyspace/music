# music — 项目约定

独立出来的音乐播放器（Next.js 15 Pages Router + Sass），**仓库根目录即项目**，
构建为静态导出后发布到 GitHub Pages 项目页：https://ianyspace.github.io/music/

代码从博客仓库 `space` 的 `components/Music/` + `pages/music/` 整体切出，
播放逻辑一行没改，只替换了三个博客专有的依赖（见下方「迁移时替换了什么」）。

## 目录

| 路径 | 作用 |
| --- | --- |
| `pages/index.js` | 入口路由，按屏宽决定跳 `/h5` 还是 `/desktop` |
| `pages/h5.js` / `pages/desktop.js` | 两套布局，共用 `MusicApp`（只差 `variant`） |
| `components/Music/` | 全部播放器代码 |
| `lib/cache/indexedDb.js` | IndexedDB 薄封装（缓存存储层） |
| `utils/retireServiceWorker.js` | 注销旧 Service Worker 的过渡代码，可删 |
| `cloudflare-worker/` | Cloudflare Worker，把 R2 桶暴露成曲库清单 |
| `scripts/check-css-modules.js` | CI 校验：每个 `styles.x` 查找都有对应 `.scss` 定义 |
| `styles/index.scss` | 唯一全局样式入口，只由 `pages/_app.js` 导入 |

> **`public/` 和 `utils/basePath.js` 都已删除**，别再照着旧印象去找。
> 服务工人（Service Worker）已彻底移除，见下方。`withBasePath()` 的唯一调用者是原
> `_app.js` 里的 SW 注册，SW 一走它就没有使用者了 —— 需要再拼 basePath 时记得自己写回来。

## 关键约定

- **样式**：全局样式**只能**由 `pages/_app.js` 导入（Next pages router 限制）；
  组件样式与组件同目录 `Foo.module.scss` + `import styles from './Foo.module.scss'`；
  kebab-case 类名必须写 `styles['foo-bar']`。
- **basePath**：`config/index.js` 的 `site.pathPrefix = '/music'` 是唯一来源（`next.config.js` 读它）。
  `next/link`、`next/image`、`_next/*` 会自动带上，其余绝对路径目前没有需要手工拼接的地方
  （原来的 `utils/basePath.js` 随 SW 一起删了，确实要用时得自己写回来）。
- **全屏浮层别放进被 `transform` 的子树**（重要，踩过坑）：`.view-in` 的 tab 切换动画
  会让 `transform` 保留终态，而带 `transform` 的祖先会成为 `position: fixed` 后代的包含块，
  于是 `inset: 0` 撑成整个滚动高度、面板被推到最底部（表现为"只有遮罩没有抽屉"）。
  抽屉 / 缓存管理这类全屏浮层一律挂在 `MusicApp` 最外层渲染。
- **没有 Service Worker，这是有意的，不要加回来**（`public/` 目录已整个删掉）。
  它曾负责预缓存页面外壳，但带来两个无法接受的代价：部署后旧外壳继续吐旧 JS；
  以及「我现在看到的是不是最新版」没法靠刷新回答 —— 排查线上问题时这个不确定性
  反复误导过判断。页面外壳由 Pages 自己提供，已经很稳，不需要中间层。
  已经装过旧 SW 的浏览器由 `utils/retireServiceWorker.js` 在加载时注销并清掉
  `music-shell-*` / `music-runtime-*` 缓存；**它只注销、永不注册**。
  旧外壳自然淘汰完（几个月）这个文件就可以删。注意：光删 `public/sw.js` 是没用的，
  已安装的 SW 不会因此消失，它只会在 fetch `sw.js` 时拿到 404 然后继续用旧缓存。
- **缓存**：音频 blob 存 IndexedDB（`lib/cache/indexedDb.js`），key 是 `<source>:<track id>`；
  曲库清单存 localStorage。**两者都是永久缓存**（`NEVER_EXPIRES = 0` 表示不过期），
  不手动清除就不清除，所以 `audioCache.js` / `librarySource.js` 里没有 TTL 逻辑，
  也不要再引入自动清理或「已过期」状态。旧版本写入的带真实 `expiresAt` 的记录仍按原时间生效。
  `audioCache.js` 上的函数全部是 best-effort，IndexedDB 不可用时自动退化成纯联网播放。
  这层是**唯一**的离线能力，所以它坏掉时症状是「播放列表空 / 不缓存」而不是「网站打不开」。
- **改 IndexedDB 的 `keyPath` 或建索引，必须同时升 `DB_VERSION`**：
  store 已存在时 `createObjectStore` 是空操作，不升版本号只有新访客能拿到修复。
  另外 `styles.x` 写错只返回 `undefined`、类名被静默丢掉，元素照常渲染却毫无样式 ——
  这类静默失效由 `scripts/check-css-modules.js` 在 CI 里兜住。

## 迁移时替换了什么

| 原（space 博客） | 现（本仓库） |
| --- | --- |
| `components/SEO`（依赖 i18n + 站点配置） | `MusicApp` 里直接用 `next/head` 写 title/description |
| `config` 里的 `site` + `supportedLanguages` | 只保留 `site` + `music`，`title` 改成 `Music Space` |
| `shared.js` 里的 IndexedDB 代码 | 拆到 `lib/cache/indexedDb.js` + `components/Music/audioCache.js` |
| 挂在 `pages/music/` 下 | 改成根路径 `/`、`/h5`、`/desktop` |
| `utils/basePath.js` | **已删除** —— 唯一调用者是 SW 注册，SW 移除后无人使用 |

## 常用命令

- `npm run dev` — 本地开发
- `npm run build` — 构建，产物在 `out/`
- `cd cloudflare-worker && npx wrangler deploy` — 部署曲库 Worker

## 部署

推 `master` 触发 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` → 校验产物 →
发布 `out/` 到 Pages。

`npm run build` 产出 `out/`，工作流再补一个 `out/.nojekyll`
（否则 Pages 的 Jekyll 会丢掉 `_next/` 这类下划线开头的目录）。
仓库里已经没有 `public/` 了，所以不再有静态文件被拷进 `out/`。

**产物形状（容易记错）**：`trailingSlash: true` 时 Next 给每个路由生成一个**目录 + index.html**，
所以是 `out/h5/index.html`、`out/desktop/index.html`，**不是** `out/h5.html`。
来源见 `next/dist/export/index.js` 里按 `subFolders` 拼 `htmlDest` 的那几行。
Pages 会把 `/music/h5/` 解析到该文件，并把裸 `/music/h5` 301 到带斜杠形式。

工作流里的 `Verify build output` 会断言这些文件都在；改路由或改 `trailingSlash` 时记得同步它，
否则 CI 会先于线上报错（这是有意的——少一个文件就是半个死站）。

**Pages 的 Source 必须是 `GitHub Actions`**：Settings → Pages → Build and deployment →
Source 选 `GitHub Actions`。**不要**留在「Deploy from a branch」。

如果留在分支模式，GitHub 会额外跑一个 Jekyll 构建（`pages build and deployment`，event=`dynamic`），
它会发布**仓库根目录**而不是我们的 `out/`，两者竞争导致线上**时好时坏**：
有时是我们的 app，过一会儿又变回 Jekyll 渲染的 README，
`/h5/`、`/desktop/`、`/.nojekyll` 全 404。
**不要因为「刚 push 完是好的」就以为没问题 —— 这个故障是间歇性的。**
（这个坑真实发生过：`f7a7cc1` 推完后整站就是挂的，`/` 是 README，`/h5/` 404。）

**一次性定性检查**（比看工作流状态更直接）—— 请求仓库根目录的文件：

```bash
curl -o /dev/null -w "%{http_code}\n" https://ianyspace.github.io/music/README.md     # 200 → 实锤
curl -o /dev/null -w "%{http_code}\n" https://ianyspace.github.io/music/package.json  # 200
curl -o /dev/null -w "%{http_code}\n" https://ianyspace.github.io/music/h5/           # 404 → 实锤
```

根目录文件能访问、而 `/h5/` 是 404，就说明发布的是仓库根（经 Jekyll），不是 `out/`。
另一个信号：首页源码里有 `Jekyll SEO tag` 或 `/assets/css/style.css?v=<sha>`。

排查时注意：`api.github.com/repos/<user>/<repo>/pages` 匿名访问返回 404 是**没权限**，不代表 Pages 没开。
