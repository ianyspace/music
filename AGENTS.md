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
| `public/` | 站点图标（favicon.ico + PNG 一套），构建时原样拷进 `out/` |
| `cloudflare-worker/` | Cloudflare Worker，把 R2 桶暴露成曲库清单 |
| `scripts/check-*.js` | CI 校验（见下方「检查脚本」），`node scripts/<name>.js` 单独跑 |
| `scripts/preview-*.js` | 视觉核验：读**构建产物里的真实 CSS** + 硬编码 markup 生成单文件 HTML，用浏览器打开即可量尺寸 |
| `styles/index.scss` | 唯一全局样式入口，只由 `pages/_app.js` 导入 |

> **`public/` 里只放图标，没有 `sw.js`** —— 服务工人已彻底移除，见下方。
> **`utils/basePath.js` 已删除**：`withBasePath()` 的唯一调用者是原 `_app.js` 里的 SW 注册，
> SW 一走它就没有使用者了。但**图标的 basePath 得自己拼**（见下一条）。

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
- **没有 Service Worker，这是有意的，不要加回来**。
  它曾负责预缓存页面外壳，但带来两个无法接受的代价：部署后旧外壳继续吐旧 JS；
  以及「我现在看到的是不是最新版」没法靠刷新回答 —— 排查线上问题时这个不确定性
  反复误导过判断。页面外壳由 Pages 自己提供，已经很稳，不需要中间层。
  已经装过旧 SW 的浏览器由 `utils/retireServiceWorker.js` 在加载时注销并清掉
  `music-shell-*` / `music-runtime-*` 缓存；**它只注销、永不注册**。
  旧外壳自然淘汰完（几个月）这个文件就可以删。注意：光删 `public/sw.js` 是没用的，
  已安装的 SW 不会因此消失，它只会在 fetch `sw.js` 时拿到 404 然后继续用旧缓存。
- **图标**：源文件是 `1000x1000` 透明底 PNG（圆形色层渐变），已导出成 `public/` 下四个文件。
  `favicon.ico` 是**真的多尺寸 ICO**（16/32/48 三档，PNG 载荷），不是改名的 PNG ——
  有些工具产出的「ico」其实只是把 PNG 改了扩展名，Windows 上会显示不出来。
  重做时用 `sharp` 出各尺寸 PNG，再手拼 ICO 容器（见提交 `167dae8` 之后那次的处理方式）。
- **图标的 basePath 必须自己拼**（踩过坑）：`public/**` 是原样拷进 `out/` 的，
  Next **不会**像 `next/link` / `_next/*` 那样替你加前缀。写成 `/favicon.ico` 在项目页
  （`/music/`）上会指向用户站点根目录然后 404 —— 本站在补上这个之前，favicon 一直是坏的。
  `pages/_document.js` 里用 `site.pathPrefix` 拼，CI 也断言这三个图标文件存在。
- **缓存**：音频 blob 存 IndexedDB（`lib/cache/indexedDb.js`），key 是 `<source>:<track id>`；
  曲库清单存 localStorage。**两者寿命不同，别搞混**：
  - **音频 blob 有 30 天 TTL**（`audioCache.js` 的 `CACHE_TTL_MS`），**每播一次就续期到 30 天后**，
    30 天没播放过才清除。最后一次播放时间存在 localStorage 的 `music:cachePlayed` 里
    （`expiryOf()` = 上次播放时间 + TTL，没打过戳的记录回落到保存时间）。
  - **曲库清单永久**（`librarySource.js` 的 `expiresAt: NEVER_EXPIRES`）——清单只是一个 URL 数组，
    过期了只会让人看到空列表，没有任何收益。
  - `NEVER_EXPIRES = 0` 的语义是「**没有任何东西给这条记录打时间戳**」，不是「永久」。
    `expiryOf()` 对没有戳的记录返回 `NEVER_EXPIRES`：**「不知道它什么时候播过」不能当成
    「它很旧」的证据**，否则会把访客整个缓存删掉。
  - 旧版本写入的带真实 `expiresAt` 的记录仍按原时间生效，不会被意外「永久化」。
- **缓存的读取路径绝对不能写**（踩过坑，且症状极难定位）：第一版 TTL 是在读缓存时把新过期时间
  写回同一条记录，而 IndexedDB 的 `readwrite` 事务会**串行化阻塞同一个 store 上的所有其他事务** ——
  于是「读下一首的缓存」永远等不到，表现为**点了播放没反应**（`6b3cd85` / `7f68c72`）。
  续期只能在播放真正开始之后做。`scripts/check-cache-ttl.js` 就是为此存在的。
- **`audioCache.js` 上的函数全部是 best-effort**，IndexedDB 不可用时自动退化成纯联网播放。
  这层是**唯一**的离线能力，所以它坏掉时症状是「播放列表空 / 不缓存」而不是「网站打不开」。
- **改 IndexedDB 的 `keyPath` 或建索引，必须同时升 `DB_VERSION`**：
  store 已存在时 `createObjectStore` 是空操作，不升版本号只有新访客能拿到修复。
  另外 `styles.x` 写错只返回 `undefined`、类名被静默丢掉，元素照常渲染却毫无样式 ——
  这类静默失效由 `scripts/check-css-modules.js` 在 CI 里兜住。

## 检查脚本

`npm run build` 不会发现的问题 —— 纯 CSS 的定位数字、跨文件的名字握手、只能靠时序
才暴露的行为 —— 都由 `scripts/check-*.js` 在 CI 里兜住。**推之前八个都要跑一遍**
（`for s in scripts/check-*.js; do node $s || break; done`），它们都是纯 Node、秒级。

| 脚本 | 兜住什么 |
| --- | --- |
| `check-css-modules` | `styles.x` 找不到定义 → 类名被静默丢掉，元素照常渲染却毫无样式 |
| `check-locate-btn` | 「回到正在播放」按钮的定位数字跨三个文件；两个布局的锚点与门控 |
| `check-ripples-setting` | 唱片波纹偏好写入点与读取点分居两个文件，还要同时关掉两套布局的波纹 |
| `check-dislike-pin` | 不喜欢 / 置顶：读一次、写每次、过滤只在一处；行内两个控件必须是**并列 button** |
| `check-cache-ttl` | 缓存读取路径不许写（见上方缓存约定） |
| `check-playback-mode` | 播放顺序的「mount 时恢复 + 变化时持久化」不能拆成两个 effect |
| `check-settings-persistence` | 所有 `music:setting:*` 键的清单守卫：有读必须有写、键名唯一、组件里不许出现字面量 |
| `check-desktop-parity` | 手机端与宽屏端的功能对齐（见下方「两套布局的缝」） |
| `check-docs` | README / AGENTS.md 与代码是否还对得上；每个检查脚本都必须登记并被 CI 调用 |

三条写法上的约定：

- **每个断言都要做变异验证**：把源码改成错的，确认脚本真的红。抓不到的断言等于没写，
  而且比没写更糟 —— 它会让人以为这块有保护。变异脚本不必提交，跑完删掉。
- **别用 `^\.foo \{[\s\S]{0,N}声明` 这种窗口去断言样式**，用 `blockOf(scss, selector)`
  抠出整条规则再断言。窗口匹配不到时，**否定断言会免费通过**（`!test()` 恒真），
  而漏写 `/m` 会让肯定断言以一个和样式无关的理由失败。两个都真踩过。
- **锚定源码时用 `\r?\n`，不要用裸 `\n`**：工作区是 CRLF、CI 是 LF，裸 `\n` 会在其中
  一边静默匹配不到。

## 两套布局的缝

`/h5` 与 `/desktop` 共用 `MusicApp` 的全部播放状态，但**各自渲染自己的列表和自己的控件**。
这个缝不会报错 —— 少接一个 prop、少一个入口，另一套布局只是「没有这个功能」而已。
已经有三次都是这样漏的：`置顶` / `移入不喜欢` 只接在手机端；桌面端列表用 Google token
（`connected`）而不是「有没有曲库」（`hasLibrary`）判断空状态，导致公共曲库明明加载好了
却显示「曲库里还没有歌曲」；`回到正在播放` 长在手机端的迷你条上，桌面端根本没有。
所以：**改一套布局时，先想另一套**；共用的东西（抽屉、面板、`rowMenu`）都在 `MusicApp`
里渲染，一套布局通常只差一个**入口**，不需要新状态。

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
- `for s in scripts/check-*.js; do node $s || break; done` — 跑全部检查（推之前必跑）
- `node scripts/preview-desktop-list.js` — 生成列表面板的可量尺寸预览页（先 `npm run build`）
- `cd cloudflare-worker && npx wrangler deploy` — 部署曲库 Worker

> 本仓库的工作区是 **CRLF**、CI 是 **LF**，且 `core.autocrlf=true`（仓库内一律 LF）。
> 用脚本批量改源码时注意别把文件写成混合行尾（Node 里 `split('\n')` 会留下 `\r`）。

## 部署

推 `master` 触发 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` → 校验产物 →
发布 `out/` 到 Pages。

`npm run build` 产出 `out/`，并把 `public/**`（现在的全部内容就是那几个图标文件）
原样拷进去；工作流再补一个 `out/.nojekyll`
（否则 Pages 的 Jekyll 会丢掉 `_next/` 这类下划线开头的目录）。

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
