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
| `lib/serviceWorker.js` | 注册离线外壳，全程静默失败（纯增强） |
| `public/sw.js` | Service Worker 本体，缓存页面外壳 |
| `utils/basePath.js` | 绝对路径拼接（`site.pathPrefix` 的唯一出口） |
| `cloudflare-worker/` | Cloudflare Worker，把 R2 桶暴露成曲库清单 |
| `styles/index.scss` | 唯一全局样式入口，只由 `pages/_app.js` 导入 |

## 关键约定

- **样式**：全局样式**只能**由 `pages/_app.js` 导入（Next pages router 限制）；
  组件样式与组件同目录 `Foo.module.scss` + `import styles from './Foo.module.scss'`；
  kebab-case 类名必须写 `styles['foo-bar']`。
- **basePath**：`config/index.js` 的 `site.pathPrefix = '/music'` 是唯一来源（`next.config.js` 读它）。
  `next/link`、`next/image`、`_next/*` 之外的所有绝对路径都必须走 `utils/basePath.js` 的 `withBasePath()`。
- **全屏浮层别放进被 `transform` 的子树**（重要，踩过坑）：`.view-in` 的 tab 切换动画
  会让 `transform` 保留终态，而带 `transform` 的祖先会成为 `position: fixed` 后代的包含块，
  于是 `inset: 0` 撑成整个滚动高度、面板被推到最底部（表现为"只有遮罩没有抽屉"）。
  抽屉 / 缓存管理这类全屏浮层一律挂在 `MusicApp` 最外层渲染。
- **缓存**：音频 blob 存 IndexedDB（`lib/cache/indexedDb.js`），key 是 `<source>:<track id>`；
  曲库清单存 localStorage。**两者都是永久缓存**（`NEVER_EXPIRES = 0` 表示不过期），
  不手动清除就不清除，所以 `audioCache.js` / `librarySource.js` 里没有 TTL 逻辑，
  也不要再引入自动清理或「已过期」状态。旧版本写入的带真实 `expiresAt` 的记录仍按原时间生效。
  `audioCache.js` 上的函数全部是 best-effort，IndexedDB 不可用时自动退化成纯联网播放。
- **Service Worker**：`public/sw.js` 只负责**页面外壳**（`/`、`/h5/`、`/desktop/` 与 `_next/static`），
  歌曲和清单不走它，避免同一份数据存两份。修改时守住这几条，否则会把用户锁在站点外：
  只拦同源 GET；`Range` 请求与跨域请求直接放行；`sw.js` 自身永不缓存；非 2xx 不入缓存；
  任何异常都回落到 `fetch(request)`，导航请求最后回落到已缓存外壳页。
  改了缓存策略记得同步升 `public/sw.js` 里的 `VERSION`，否则旧缓存不会失效。
- **`public/` 会被原样拷进 `out/`**：所以 `sw.js` 必须放在 `public/` 下、并保证路径是
  `/music/sw.js`（`pages/_app.js` 用 `BASE_PATH` 拼出来）。
- `.gitignore` 只忽略 `/.next/` 和 `/out/`，**不要**忽略 `public/`。

## 迁移时替换了什么

| 原（space 博客） | 现（本仓库） |
| --- | --- |
| `components/SEO`（依赖 i18n + 站点配置） | `MusicApp` 里直接用 `next/head` 写 title/description |
| `config` 里的 `site` + `supportedLanguages` | 只保留 `site` + `music`，`title` 改成 `Music Space` |
| `utils/basePath.js`（同款） | 原样保留 |
| `shared.js` 里的 IndexedDB 代码 | 拆到 `lib/cache/indexedDb.js` + `components/Music/audioCache.js` |
| 挂在 `pages/music/` 下 | 改成根路径 `/`、`/h5`、`/desktop` |

## 常用命令

- `npm run dev` — 本地开发
- `npm run build` — 构建，产物在 `out/`
- `cd cloudflare-worker && npx wrangler deploy` — 部署曲库 Worker

## 部署

推 `master` 触发 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` → 发布 `out/` 到 Pages。

`npm run build` 会把 `public/**`（含 `sw.js`）拷进 `out/`，工作流再补一个 `out/.nojekyll`
（否则 Pages 的 Jekyll 会丢掉 `_next/` 这类下划线开头的目录）。

**首次需要在 GitHub 仓库里手动开一次 Pages**：Settings → Pages → Build and deployment →
Source 选 `GitHub Actions`（工作流里的 `configure-pages` 只读配置，建站需要仓库管理员权限）。
