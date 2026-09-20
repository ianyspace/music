# music — 项目约定

独立出来的音乐播放器（Next.js 15 Pages Router + Sass），**仓库根目录即项目**，
构建为静态导出后发布到 GitHub Pages 项目页：https://ianyspace.github.io/music/

代码从博客仓库 `space` 的 `components/Music/` + `pages/music/` 整体切出，
播放逻辑一行没改，只替换了三个博客专有的依赖（见下方「迁移时替换了什么」）。

**`/h5`、`/desktop`、`/3d` 是三棵完全独立的组件树**：彼此不 import 任何一个文件，
只共用 `components/Music/core/`（状态机 + 数据层 + 面板内容）和它旁边的纯函数。
桌面端的每一个面都是**纯 CSS 毛玻璃**（`backdrop-filter` + `--glass-*` token）；
3D 版是唯一有 WebGL 的树（`three` + 自有的 `--t-*` token，只深色）。
详见下方「三套布局」。

## 目录

| 路径 | 作用 |
| --- | --- |
| `pages/index.js` | 入口路由，按屏宽决定跳 `/h5` 还是 `/desktop` |
| `pages/h5.js` / `pages/desktop.js` / `pages/3d.js` | 三个薄路由，各自只渲染一棵树，互不相干 |
| `components/Music/h5/` | 手机端：`MusicApp` 外壳 + 列表/播放页/迷你条/我的 + 三个底部面板 |
| `components/Music/desktop/` | 宽屏端：`DesktopApp` 外壳 + 沉浸式舞台（`DesktopMusic`）+ 玻璃弹窗 + 行抽屉 |
| `components/Music/three/` | 3D 版：`ThreeApp` 外壳 + `ThreeStage`（canvas/rAF/指针）+ `ThreeHud` + `scene/`（纯 three.js，不含 React） |
| `components/Music/core/` | 三套布局共用的中性核心（见下方「三套布局」） |
| `components/Music/`（根） | 只放共享件：`Cover` / `Marquee` / `icons` / `shared` / `audioCache` / `librarySource` |
| `lib/cache/indexedDb.js` | IndexedDB 薄封装（缓存存储层） |
| `utils/retireServiceWorker.js` | 注销旧 Service Worker 的过渡代码，可删 |
| `public/` | 站点图标（favicon.ico + PNG 一套），构建时原样拷进 `out/` |
| `cloudflare-worker/` | Cloudflare Worker，把 R2 桶暴露成曲库清单 |
| `scripts/preview-*.js` | 视觉核验：读**构建产物里的真实 CSS** + 硬编码 markup 生成单文件 HTML，用浏览器打开即可量尺寸 |
| `styles/index.scss` | 唯一全局样式入口，只由 `pages/_app.js` 导入 |

> **`public/` 里只放图标，没有 `sw.js`** —— 服务工人已彻底移除，见下方。
> **`utils/basePath.js` 已删除**：`withBasePath()` 的唯一调用者是原 `_app.js` 里的 SW 注册，
> SW 一走它就没有使用者了。但**图标的 basePath 得自己拼**（见下一条）。

## 关键约定

- **样式**：全局样式**只能**由 `pages/_app.js` 导入（Next pages router 限制）；
  组件样式与组件同目录 `Foo.module.scss` + `import styles from './Foo.module.scss'`；
  kebab-case 类名必须写 `styles['foo-bar']`。
  CSS Modules 生成的类名是 `[文件名]__[类名]__[hash]`，**目录不进名字** ——
  所以把文件挪进子目录不会改类名（这次拆分正是靠这一点）。
- **三棵树不许互相 import**：`components/Music/h5/**` 里不许出现 `desktop` 或 `three`，
  其余同理。共用的东西只能落在 `components/Music/core/` 或 `components/Music/` 根下
  （根下的 `icons.js` 是共享图标集；`three/icons.js` 是 3D 版**自己的**一套，两边不通用）。
  这条没有脚本兜底（见「检查脚本已删除」），改完请自己 `grep` 一遍。
- **basePath**：`config/index.js` 的 `site.pathPrefix = '/music'` 是唯一来源（`next.config.js` 读它）。
  `next/link`、`next/image`、`_next/*` 会自动带上，其余绝对路径目前没有需要手工拼接的地方
  （原来的 `utils/basePath.js` 随 SW 一起删了，确实要用时得自己写回来）。
- **全屏浮层别放进被 `transform` 的子树**（重要，踩过坑）：手机端 `.view-in` 的 tab 切换动画
  会让 `transform` 保留终态，而带 `transform` 的祖先会成为 `position: fixed` 后代的包含块，
  于是 `inset: 0` 撑成整个滚动高度、面板被推到最底部（表现为"只有遮罩没有抽屉"）。
  抽屉 / 缓存管理这类全屏浮层一律挂在各自外壳（`h5/MusicApp` / `desktop/DesktopApp`）
  的最外层渲染 —— 桌面端虽然没有 tab 动画，也照此办理，免得以后加了动画再踩一次。
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
  续期只能在播放真正开始之后做。（原来有个 `check-cache-ttl.js` 守着这条，已随检查脚本一起删，
  改 `audioCache.js` 时请自己确认「读路径一行都没写」。）
- **`audioCache.js` 上的函数全部是 best-effort**，IndexedDB 不可用时自动退化成纯联网播放。
  这层是**唯一**的离线能力，所以它坏掉时症状是「播放列表空 / 不缓存」而不是「网站打不开」。
- **改 IndexedDB 的 `keyPath` 或建索引，必须同时升 `DB_VERSION`**：
  store 已存在时 `createObjectStore` 是空操作，不升版本号只有新访客能拿到修复。
  另外 `styles.x` 写错只返回 `undefined`、类名被静默丢掉，元素照常渲染却毫无样式 ——
  `npm run build` **不会**报这个（原来靠 `scripts/check-css-modules.js` 兜住，已删）。
  现在只能靠人眼：新增/改名类名时，`styles.foo` 里的 `foo` 一定要在同一个
  `Foo.module.scss`（或它 `composes` 的 `sheetBase.module.scss`）里出现过。
- **封面和歌词都是「同名附属文件」**：数据层给两种来源各留一组字段（cloud 是 Worker 解析好的
  公开链接 `coverUrl` / `lyricsUrl`，drive 是文件对象 `coverFile` / `lyricFile`），
  **只有 `coverUrlOf()` / `lyricsUrlOf()` 知道哪个是哪个**，调用方一律走它们，不要自己判 source。
  渲染时封面是**盖在渐变之上的叠加层**（`components/Music/Cover.js`）：有图用图，
  没有、或图加载失败（歌没传封面、Drive 缩略图过期、Worker 还是旧版）就露出调用方本来就画着的
  `trackGradient` —— 所以「没有封面」不需要任何单独的分支，`Cover` 返回 `null` 就是全部处理。
  两点容易踩：① 图片是 `position: absolute` 的叠加层，宿主 tile 必须是定位元素，且 `<Cover>`
  要放在**第一个子节点**（音符图标被它盖住是对的，行的播放/暂停遮罩必须盖在它上面）；
  ② **公共曲库加封面要重新部署 Worker** 才生效，旧 Worker 不返回 `coverUrl` 时客户端会退回
  按 `.jpg` 猜名字（`guessCoverUrl`，代价是每首没封面的歌一个 404）。
  **锁屏 / 耳机键的封面是第三个用到它的地方**（`core/usePlayer.js` 的 mediaSession effect，选图逻辑在
  `shared.js` 的 `mediaArtwork`）。这里没有 `Cover` 那种「返回 null 就露出渐变」的便宜：
  那张图是**操作系统自己去取的**，取不到时只会空白，所以失败要由我们兜 —— 一个 `Image()`
  探针的 `onerror` 会**再写一次 metadata**，把 `mediaArtwork('', name)` 画出来的渐变发过去。
  探针必须在 effect 的清理里摘掉，否则上一首的失败会重画下一首的 metadata。
  `MediaMetadata.artwork` 里只有渐变那一项声明 `sizes`（它按构造就是 320×320），封面不声明 ——
  不知道尺寸的 `sizes` 是给锁屏的一句假承诺。
- **空列表的文案只有一处决策**（`shared.js` 的 `emptyListMessage`），四个分支按顺序判断：
  还在加载 → 搜了没搜到 → `libraryCount > 0` 说明歌都被移进「不喜欢」了 → 曲库真的空。
  两个容易搞错的地方：
  - **`libraryCount` 是过滤前**（`tracks.length`）**的曲库数**，不是 `trackCount` / `visibleTracks.length`。
    传错这一个值，「全被不喜欢」就会被判成「曲库空」，然后指引访客去换文件夹 —— 一个他照做
    也解决不了问题的建议。两套布局各传一次，`core/usePlayer` 把两个数都返回了，别接错。
  - **文案是列表的兄弟节点，不能塞进 `<ul>`**：`<ul>` 里只能有 `<li>`，塞 `<p>` 是无效 HTML，
    而且读屏会把这句话当成列表的一项念出来。手机端列表**保持挂载**（播放条的「回到正在播放」
    按 `id="ms-track-list"` 找它），所以消息挂在 `<ul>` 之后；桌面端则是直接把列表换掉。
    两端共用 `.list-empty` 这一个类名（以前手机端叫 `lib-loading` / `lib-empty`，还共用一条规则）。
  文案由 `node scripts/preview-empty-list.js` 出图核对。

## 检查脚本已删除

这里原来有 11 个 `scripts/check-*.js`，在 CI 里兜 `npm run build` 抓不到的问题
（纯 CSS 的定位数字、跨文件的名字握手、只能靠时序才暴露的行为）。**已全部删除**，
连同 `.github/workflows/deploy.yml` 里对它们的调用。`Verify build output` 那一步
剩下的只有对 `out/` 里文件是否存在的断言，那些还在。

**这意味着什么**：下面这些约定从「有机器守卫」变成了「靠人读文档 + 人眼比对」。
改到相关代码时请格外小心，它们的共同点是**坏了不报错**：

- `styles.x` 写错 → 类名被静默丢掉，元素照常渲染却毫无样式。
- 缓存读路径写了东西 → IndexedDB 事务串行化，表现为「点了播放没反应」。
- 空列表传错 `libraryCount` → 把「全被不喜欢」说成「曲库空」。
- 两套布局只改一套 → 另一套只是「没有这个功能」，不报错。
- 封面叠加层的定位/绘制顺序 → 照片跑到别处、或盖住播放按钮。
- 播放顺序的「mount 恢复 + 变化持久化」拆成两个 effect → 把访客的选择覆盖掉。

`scripts/preview-*.js` **保留**，它们是纯视觉核验（读构建产物里的真实 CSS +
硬编码 markup 生成单文件 HTML），不属于 CI，也不随这次改动消失。

### 写断言时仍然成立的几条约定

万一以后重新加回校验脚本，这几条坑别再踩一遍：

- **每个断言都要做变异验证**：把源码改成错的，确认脚本真的红。抓不到的断言等于没写，
  而且比没写更糟 —— 它会让人以为这块有保护。变异脚本不必提交，跑完删掉。
- **别用 `^\.foo \{[\s\S]{0,N}声明` 这种窗口去断言样式**，用 `blockOf(scss, selector)`
  抠出整条规则再断言。窗口匹配不到时，**否定断言会免费通过**（`!test()` 恒真），
  而漏写 `/m` 会让肯定断言以一个和样式无关的理由失败。两个都真踩过。
- **锚定源码时用 `\r?\n`，不要用裸 `\n`**：工作区是 CRLF、CI 是 LF，裸 `\n` 会在其中
  一边静默匹配不到。
- **模板字符串（preview 脚本里那整页 HTML）的注释里不要写反引号**：反引号会把模板提前闭合，
  报成 `SyntaxError: Unexpected identifier`，而且指到的行离真正的错误很远。这个坑踩过两次
  （`locate-in`、`pointer-events: none`），照常写 `pointer-events:none` 就行。

## 三套布局

```
pages/h5.js ───────▶ components/Music/h5/MusicApp.js ────────┐
                                                              │
pages/desktop.js ──▶ components/Music/desktop/DesktopApp.js ─┼─▶ components/Music/core/
                                                              │   + Cover/Marquee/icons/
pages/3d.js ───────▶ components/Music/three/ThreeApp.js ─────┘   shared/audioCache/librarySource
```

三棵树之间**没有任何 import**。`/h5` 里没有一行代码知道桌面端存在，反之亦然；
`/3d` 也不 import 另外两棵树里的任何一个文件。
共用部分按职责分三块：

| `core/` 文件 | 是什么 | 为什么放这儿 |
| --- | --- | --- |
| `usePlayer.js` | 全部播放状态：曲库、缓存、歌词、Google、主题、抽屉开关 | 三套布局要共享**行为**，且必须逐字一致 |
| `PageHead.js` | `<Head>` 标题 + GSI `<Script>` | 两个页面都要有同样的 title 和同一份 GSI 加载错误文案（3D 版**不用**它，见下） |
| `PlayerAudio.js` | 那唯一一个 `<audio>` | 六种 handler 由 `usePlayer` 统一返回，少接一个就是「进度条永远不动」且不报错 |
| `CacheContent.js` / `DislikedContent.js` | 缓存管理 / 不喜欢歌曲的**内容** | 两个面板的**外壳**不同（底部抽屉 vs 玻璃卡片），内容相同 |
| `sheetBase.module.scss` | `.body` / `.state` | 面板内容共用的滚动容器与加载文案 |

**面板一律「内容 + 外壳」两半**：内容在 `core/`，外壳各自实现
（`h5/SheetChrome.*` 是底部升起的抽屉，`desktop/DesktopSheetChrome.*` 是居中的玻璃卡片）。
内容组件返回的是 **Fragment**，因为外壳是个 flex column，它那几块要当直接子节点才能保住
`flex-shrink: 0` / `flex: 1`。

`usePlayer` 返回一个扁平的 ~80 字段对象（而不是拆成几个小 hook），就是为了让这次拆分
能**逐字搬迁**手机端的行为 —— 拆 hook 会顺手改掉依赖数组和执行顺序。

`lyricsAutoOpen` 是各套布局**唯一**真正分歧的地方：桌面端的舞台就是歌词，
有歌词就展开是对的；手机端则会平白盖住自己的列表；3D 版传 `false` 再自己接管，
原因见「3D 版」一节。

桌面端列表还有一条手机端没有的规则：**有歌在放、鼠标又不在列表上，3 秒后列表自己收起**
（`LIST_HIDE_MS`）。它折的是 `autoHidden`，不是 `listOpen` —— 后者是访客的选择、
是要存进 localStorage 的那个；前者只是播放器替访客做的临时决定，所以暂停、搜索、
开着菜单、鼠标回到列表上都会立刻把它放回来。写这个 effect 时依赖必须是**布尔量**
（`hasCurrent` 而不是 `current`）：`current` 每次渲染换身份的话，定时器会被反复
清掉重设，列表就永远不会收起。

**`current` 不是一首歌，是 `{ track, url, startTime, shouldPlay }`。**
歌在 `current.track` 里 —— 要写 `current.track.name`、`current.track.id`、
`coverUrlOf(current.track)`。判断「有没有歌在放」用 `Boolean(current)` 就对了，
一旦要**读字段**就必须往下走一层。这一条被踩过一次，而且一次踩出三个症状：
3D 版整棵树写成了 `current.name` / `current.id` / `coverUrlOf(current)`，
于是点列表里任何一首歌都会**把整页打崩**（`parseTrackName` 第一行就是
`name.match(...)`，拿到 `undefined` 就抛；React 19 渲染期抛异常会卸掉整棵树，
只剩错误边界那张卡片），同时唱片标签永远不上封面、正在播的那一行永远不高亮。
三个症状一个原因，改完三处一起好。

**改一套布局时先想另一套**。以前这个缝漏过三次：`置顶` / `移入不喜欢` 只接在手机端；
桌面端用 Google token 而不是 `hasLibrary` 判空状态，导致公共曲库明明加载好了却显示
「曲库里还没有歌曲」；`回到正在播放` 长在手机端迷你条上，桌面端根本没有。
现在两套是独立文件，漏了更不会报错 —— 只是那一套「没有这个功能」而已。

### 桌面端的毛玻璃

**纯 CSS，没有 WebGL，没有玻璃库**（原来的 `@ybouane/liquidglass` 已卸载）。
一个「玻璃面」就是三件事：半透明填充 + 发丝描边 + `backdrop-filter`。

**它是平的，不是立体的**。这里曾经有第四件事 `--glass-inset`
（`inset 0 1px 0 rgba(255,255,255,…)`，每个面的上沿一条亮线）和 `--glass-shadow`
里那层紧贴的 `0 2px 10px -4px`。那条亮线就是「立体感」的来源 —— 一个被照亮的盖子，
读成凸起的塑料按钮，而不是一块磨砂玻璃。两个都已删除，`--glass-shadow` 只剩一层
宽而淡的环境投影（只是把面和背后的色场分开，不描边）。**加回任何内阴影 / 顶高光
都会把这个观感带回来**，要加请先确认。

token 只在**一处**声明：`desktop/DesktopApp.module.scss` 的 `.page`（浅色）和
`.page.theme-dark`（深色）。`DesktopMusic.module.scss`、`DesktopSheetChrome.module.scss`
以及 `core/` 的内容组件全部只**消费**、不声明 —— 一个定义，工作台和外壳就不可能各走各的。

| token | 用途 |
| --- | --- |
| `--glass-blur` / `--glass-sat` | `backdrop-filter: blur() saturate()` 的两个参数 |
| `--glass-bg` | 常规面：胶囊播放条、设置按钮、折叠后的列表开关 |
| `--glass-bg-soft` | 玻璃**之上**的凹陷（搜索框、输入框、设置里的曲库卡片） |
| `--glass-bg-strong` | 要压住繁忙内容的面：设置弹窗、面板卡片、toast、定位按钮 |
| `--glass-border` / `--glass-shadow` | 描边、环境投影 |

`.backdrop` 是**独立的兄弟层**（不是 `.root` 自己的背景）：`backdrop-filter` 只采样
它**背后**已经画好的东西，把四团色晕放在自己那一格里，模糊才有东西可糊。
`.glow` 是它上面再一层、用当前歌曲的 `trackGradient` 做的圆形色晕（`mask-image`
抠出来的软边，不是 `filter: blur()` —— 同样的边缘，一次绘制，没有离屏大缓冲）。

**不支持 `backdrop-filter` 的浏览器**由 `DesktopApp.module.scss` 里一个
`@supports not (…)` 兜住：它只把三个 `--glass-*` 的 alpha 提到接近不透明，
布局、描边、投影一律不动 —— 所以没有任何东西会移位，只是不再透。
那段必须和 token 声明在同一个文件里，否则会被 `.page` 的浅色值按源码顺序盖掉
（所以里面写的是 `.page.theme-dark` 而不是 `.theme-dark`）。

### 桌面端：舞台占满全屏，别的东西都浮在上面

```
.root  (100vh，overflow: hidden —— 整页不滚动)
├── .backdrop / .glow          色场，铺满
├── .stage  (absolute; inset: 0)   ← 唯一有自己布局的块
│     ├── .stage-record         唱片（有歌词时 opacity: 0，不卸载）
│     └── .lyrics               歌词，absolute 铺在 stage 上
├── .side    (absolute)  列表：无面板背景，直接滚动
├── .settings-btn (absolute)
└── .bar     (absolute)  胶囊播放条
```

**这是桌面端最容易改坏的一条约定**：舞台是 `position: absolute; inset: 0`，
其余全是它的**兄弟**、绝对定位在它上面 —— 所以折叠列表、开设置弹窗、切歌词
都不可能让唱片挪一个像素。想让某个新控件「浮着」，就绝对定位；一旦把它塞进
`.stage` 的流里，它就会开始推唱片。

几条随之而来的硬约束：

- **`.root` 不能有 `transform` / `filter`**：那会让 `position: fixed` 的
  面板 / 弹窗以它为包含块，`overflow: hidden` 就会把它们裁掉。
- **`.side` 是 `pointer-events: none`**，只有里面的开关和 `.panel` 是 `auto` ——
  否则列表那一列空白会把本该落到唱片上的点击吃掉。
- **胶囊播放条的几何写在 `.root` 上**（`--bar-h: 64px` / `--bar-bottom: 26px`），
  因为 `.side` 的底边要用它来让开播放条。改一个数字，两处一起动。
- **`.seek` 是绝对定位在胶囊内部的**（贴着下沿、左右各让开 30px）：
  胶囊的圆角是 999px，行内边距小于这个数时内容会跑到填充外面去
  （半径 32 时，内容行的上下边缘处圆角会吃掉约 13px）。
- **`.bar-row` 的 `padding-bottom: 11px` 不是留白，是让位**：
  它把内容行的中心抬到离胶囊底 37.5px，40px 的控件才会和进度轨保持 5px 间隙、
  和胶囊顶保持 6.5px。**没有它，播放键就会压在进度条上** ——
  76px 的旧高度是用 18px 的空玻璃把这个问题盖住的，高度一收紧就露出来了。
- **唱臂的盒子按「手机端的坐标系相对唱片」算，不是按眼睛调**：
  `.arm` 是 `width: 116.28%; height: 141.86%; top: -20.93%; left: -8.14%`。
  这四个数全部来自手机端 —— 那边 `.rig` 的 `aspect-ratio` 是 `100 / 122`
  （**就是唱臂 SVG 的坐标系**），唱片是 rig 宽度的 `86%` 且居中；桌面端反过来，
  rig 就是唱片，所以唱臂的盒子得是 `100 / 86` 宽、`122 / 86` 高，再往左上
  各推 `(1.1628 - 1) / 2 = 8.14%` / `(1.4186 - 1) / 2 = 20.93%`。
  这样两边「一个 SVG 单位 = 1/86 张唱片」，**共用的那段 path 才真是同一个物体**。
  它曾经是 `width: 46%`（按眼睛调的覆盖层），于是桌面端的唱臂比手机端**小 2.5 倍** ——
  一枚玩具般的唱臂趴在唱片上，转轴只有豌豆大。改这个数之前先想清楚：
  它同时决定唱臂、唱针和转轴三者的尺寸（同一个 `viewBox` 等比缩放）。
  盒子变大不会挤到别的东西：它画出来最左的东西是转轴的光晕（`0.47` 倍唱片宽），
  最低的是唱针（落在唱片右上缘 `0.98` 半径处，和手机端同一点），
  多出来的面积几乎全是空的。旋转中心不受影响 ——
  `.arm-swing` 的 `transform-origin: 52.5% 3.77%` 是 `view-box` 单位，与盒子大小无关。
- 列表的 `.list` 用 `mask-image` 在**两端**渐隐，而且两端的长度是**变量**
  （`--fade-top` / `--fade-bottom`，默认 `0px`），由 `DesktopMusic` 的 `listEnds`
  按滚动位置设成 `36px`：面板没有边框，硬切会被读成「面板被裁了」，
  而渐隐只有在那一头**确实还有内容**时才该出现 —— 短到不用滚的列表两端都不渐隐，
  滚到底之后下沿也不再渐隐。一条渐变 + 两个长度，四种状态（都不 / 只上 / 只下 / 都）
  只差数字；`0px` 时停靠点重合，本身就是 no-op，所以默认状态不需要额外规则，
  也不需要 `mask-image: none` 去撤销。
- **行的 hover 底色长在 `<li>` 上**（`.track-row` / `.track-row-active`），
  不在 `.item` 上：右侧的三个点是行的一部分，底色只铺到播放按钮就停下，
  会被读成「两个控件」。`.track-row-active` 必须声明在 `.track-row:hover` **之后**
  （两者同权重），并且要自己写 `:hover`，否则悬停中的播放行会掉回 `--hover`。
  **`.track-row-active` 是「加到 `.track-row` 上」，绝不能替代它** ——
  这里踩过一次：`<li>` 曾经二选一地挂一个类，而布局（`display: flex`、居中、
  圆角）全在 `.track-row` 上，于是正在播放那一行退化成普通块级盒，
  播放按钮撑满整宽、三个点被挤到第二行，**整行比别的行高一倍**。
  随之而来的：`.item-more:hover` **只改颜色、不填底** —— `--hover` 是半透明的，
  再填一次会把同一层淡色画两遍，行里会出现一块明显更深的方块。
- **列表那一列顶部是一行两个 36px 方块**（`.side-head`：折叠开关 `.side-toggle`
  + 搜索按钮 `.search-btn`），展开搜索时 `.search` 顶掉按钮、占满这一行剩下的宽度。
  三者都是 36px、圆角都是 12px，所以开合搜索时列表一个像素都不动 ——
  它们曾经是上下两行（开关在列顶、搜索在面板自己的工具行），白占一行高度。
  `.side-head` 和 `.side` 一样是 `pointer-events: none`，只有两个控件是 `auto`：
  行里搜索没占满的那半边是悬在唱片上的空白，不能吃掉点击。
  折叠时搜索跟着列表一起走（`.side-folded .search-btn, .side-folded .search`，
  用 `visibility` 而不是 `display`，行高不变、开关不移位；`.search` 上不能用
  `opacity`，因为 `search-open` 动画的 fill 优先级高于普通声明）。
  **折叠开关的图标必须分状态**：展开时 `IconPanelFold`（雪佛龙头朝左，
  「收起来」），折叠时 `IconPanel`（朝右，「拿出来」）—— 两个是同一枚图标的镜像，
  形状不同会被读成两个控件。原来两种状态共用一枚图标，那个按钮就没法说明自己要往哪走。
  列表头上那个三点弹出菜单（`.menu-*`）**已删除**：它的三项
  （云盘账号 / 缓存管理 / 不喜欢歌曲）都搬进了右上角设置弹窗，其中「不喜欢歌曲」
  是新增的一行，且**不在 `connected` 分支里** —— 公共曲库也有被隐藏的歌。
- **唱片下方不再有歌名 / 歌手**（`.head*` 四条规则已删除，`.stage-record` 现在只装唱片）。
  理由不是「简洁」，是**同一首歌在页面上被说了三遍**：列表行、唱片下方、胶囊条，
  而唱片下方那遍最响、却既点不动也拖不动。要再放东西到唱片下面，
  先确认它不是在重复别处已有的信息。`.stage` 的 `padding-bottom: 12vh`
  与 `.rig` 的 `56vh` 都还留着 —— 前者现在负责让唱片避开播放条，
  后者当初是按「唱片 + 标题」算的，标题没了就有余量，但 56vh 是唱片被调好的尺寸，
  不要因为「有余量」就顺手放大。
- **底部胶囊条里没有唱片**：`.bar-disc` 那枚 36px 旋转黑胶已删除 ——
  舞台有真的唱片、行里有封面，那是第三份；在这个尺寸上它只是一枚带糊图的深色圆点。
- **播放 / 暂停键是平的**：40px、`background: var(--accent)`、**没有渐变也没有红色辉光**
  （旁边四个是 36px）。它曾经是 `linear-gradient(accent-2 → accent)` + `0 12px 26px -10px`
  的红色光晕 —— 一颗被照亮的凸起红球，正好是全站刚删掉的那种立体感，
  和「纯毛玻璃」的页面放在一起谁也不像谁。尺寸本身也一路收过 50 → 44 → 40，
  但**光靠尺寸解决不了「它比整条还响」**：真正的问题是它被画成了发光体。
  手机端的播放键是 30px 装 18px 图标（图标撑满按钮），桌面端是 40px 装同一个 18px 图标 ——
  重量落在环上，这才是「一排 36px 里的主按钮」该有的样子。
- **条里的字号**：歌名 14px（手机端迷你条在 58px 高里用 13px），时间 12px。
  胶囊矮下来之后字号必须跟上，否则会显得空。
- **滚动条默认隐形，hover / focus 才显形**：这条规则是 `.list, .settings-body` **并列**的
  一条（页面上只有这两处滚动）。`scrollbar-width: thin` +
  `scrollbar-color: transparent transparent`，`:hover` / `:focus-within` 时换成
  `var(--track)`，同时把 `::-webkit-scrollbar-thumb` 的 `background` 一起换掉
  （两套写法都设成同一行为，因为引擎可能认标准属性、也可能认 `::-webkit-*` 伪元素：
  Chrome 的几何取自 `scrollbar-width`、绘制取自伪元素）。
  关键是 **`thin` 而不是 `none`**：滚动槽一直占着那 10px，所以显形时一行都不会横移
  （实测两种状态下 `row item x 18 → 288` 完全一致）。hover 那半放在
  `@media (hover: hover)` 里（触屏上 `:hover` 会黏在最后点过的东西上），
  `:focus-within` 不在里面 —— 键盘没有指针。
- 行按钮（`.item` / `.item-active`）的 `:focus-visible` 用 `outline-offset: -2px`
  （**内缩**）：行是紧挨着排的，外扩的环会画到上一行身上。
- **唱片的宽度要自己让开列表那一列**：
  `min(56vh, 44vw, 700px, max(300px, calc(100vw - 2 * var(--side) - 56px)))`。
  `44vw` 不够 —— 它量的是整个视口，而唱片是居中在视口里的，所以「窄而高」的窗口
  （1920×1080 屏左右分屏后就是 960×1040）会让 `56vh` 把唱片撑到左缘滑进列表下面
  （900×1000 实测 −19px）。第四项按 `--side` 在两侧各留一列，保证行与唱片之间
  恒有 40px；它在 ~1340px 宽以上不会生效，所以常见尺寸一点没变。
  外面那层 `max(300px, …)` 是**下限**：第四项在 616px 宽时会归零，
  而一枚缩到看不见的唱片比一枚稍微探到列表下面的唱片更糟。下限在 ~880px 宽以下
  才开始生效，已经在 `pages/index.js` 把访客送去 `/h5` 的 900px 之下 ——
  所以桌面布局真正服务的每个宽度都还是正间距（900×1000 是 32px）。

## 3D 版

`/3d` 是第三棵树，入口只有一处：`/desktop` 右上角设置弹窗里的「进入 3D 沉浸模式」
（`DesktopApp` 用 `router.push('/3d')`，`DesktopMusic` 只收一个 `onOpen3D` 回调 ——
和缓存管理、不喜欢歌曲一样，路由的事留在外壳）。手机端**没有任何入口**：
一个可拖拽机位的 WebGL 场景不是手机体验。

```
components/Music/three/
  ThreeApp.js         外壳：usePlayer(只读子集) + 两个局部视图开关 + PlayerAudio
  ThreeApp.module.scss 这一页唯一的 token 根（--t-*，只深色）+ 全部 chrome
  ThreeStage.js       唯一有副作用的 React 文件：canvas、rAF、指针、ResizeObserver
  ThreeHud.js         全部浮层 DOM（顶栏 / 列表 / 胶囊条 / 提示 / toast）
  icons.js            自己的 13 个图标，stroke 1.7（共享集是 2）
  scene/              纯 three.js，**不含任何 React**
    index.js          装配：renderer / 雾 / PMREM 环境 / 四盏灯 / 机位 / 主循环 frame()
    camera.js         四机位 rig + 拖拽 + 7 秒后自动漂移 + 节拍推进
    record.js         唱盘 + 唱片 + 倒影 + 光池 + 光环
    tonearm.js        真解算的唱臂（正弦定理，随播放进度内移）
    particles.js      5000 粒尘埃：星系 / 环两种形态，同一对三角函数、同一个 attribute
    lyrics.js         canvas 贴图歌词平面 —— 场景里最大的物体，另加一层加色发光
    textures.js       六种程序化 canvas 贴图，**零资源文件**
    analyzer.js       Web Audio 分析 + 合成节拍回退
```

几条不能随手改的：

- **只复用 `core/`，不复用任何组件。** `three/` 里出现 `../h5/` 或 `../desktop/`
  就是错的。`core/usePlayer` 只取播放 / 曲库 / 歌词 / toast 这一读子集：行抽屉、
  缓存管理、不喜欢、Google 授权全都留在 `/desktop` —— 3D 版**没有能力改曲库**，这是故意的。
- **`usePlayer({ lyricsAutoOpen: false })` 不等于「不显示歌词」。** 3D 版自己接管：
  `lyricsWanted`（默认 true）+ 一个 effect，在有歌词的歌到达时补一次 `toggleLyrics()`。
  之所以不能直接传 `true`：hook 在每次换歌时都会 `setLyricsVisible(lyricsAutoOpen && withLyrics)`，
  传 `true` 会让访客的「关掉歌词」在下一首就失效。传 `false` 再自己补，关掉才关得住。
- **3D 版不用 `core/PageHead`**，只写自己的 `<Head>`：那个组件会顺带加载 Google
  Identity Services 脚本，而这一页没有任何地方能用上它。
- **这一页绝对不许白屏，这是硬要求。** React 19 里 mount effect 抛异常会把整棵树卸掉，
  剩下的是 `styles/index.scss` 里 `html, body` 的 `#f6f6f7` —— 一片白，加控制台一行字。
  所以三层防护缺一不可：`scene/index.js` 的 `createRenderer` 三次重试后抛带原因的错、
  `ThreeStage` 把建场和每一帧都包在 try/catch 里、`pages/3d.js` 外面套 `ThreeBoundary`。
  **`ThreeBoundary` 必须在 `ThreeApp` 外面**（它是边界，得在被保护的东西之上），
  它的 `.crash` 因此不能依赖 `.page` 上的 token —— `--t-*` 声明在 `.page, .crash` 这个
  **并列选择器**上。
- **canvas 由 `scene/index.js` 创建并 append 到宿主 div，不由 React 渲染。**
  原因是失败重试：一个 `getContext` 失败的 canvas 不能再用（规范没写清，但实际如此），
  每次重试必须换一张新的 canvas，而 React 渲染的 canvas 换不掉。
  重试顺序是 `(antialias, high-performance)` → `(antialias, default)` → `(no antialias, default)`，
  对应「双显卡笔记本拿不到独显」和「弱显卡不给多重采样缓冲」两个常见原因。
  `dispose()` 要把 canvas 从宿主里摘掉，否则重试会叠第二张。
- **`webglcontextlost` 要 `preventDefault()` 并告诉调用方**：不 preventDefault 上下文
  永远恢复不了；告诉调用方是为了让 rAF 停下来、把话说在屏幕上，而不是留一块黑画布。
- **rAF 里每帧都要 try/catch**：一帧抛异常就是每帧抛异常，会以 60 次/秒的速度刷控制台。
- **粒子只有一对三角函数，两种形态是同一对值的两种读法。** 每颗粒子的角度是 `base + ωt`；
  星系读成 `x = cos·r, z = sin·r`（水平圆盘），环读成 `x = cos·r, y = RING_Y + sin·r·flat`
  （竖着的椭圆）。所以形态切换只是绕 x 轴转过去，多花两次乘法，不需要第二套坐标。
  两件事不要随手改：
  - **环要有自己的时钟**（`RING_SPIN`，而且和唱片反向）。环如果跟着星系的分壳自转，
    内外差速会在一两分钟内把它剪成螺旋 —— 让星系活起来的那套物理，正好是毁掉环的那套。
  - **角度要按椭圆弧长采样**（`pickAngle`），不能均匀取。扁椭圆的 `ds/dθ` 从侧面的 1
    降到两端的 `flat`，均匀角度会把尘埃堆成左右两坨，环就不再是环。用拒绝采样做，
    只在 mount 时跑一次，运行时零成本。
- **粒子材质必须 `toneMapped: false`，而且不能靠提亮来塑形。** ACES 曲线会把加色点压成
  灰点（第一版 1500 粒 / size 0.03 就是这么消失的）；反过来，形态切换时再给材质加增益
  会得到一个实心光圈。**形状靠密度，不靠增益**：环的径向带很窄（有边），但很深（是环面
  不是扁箍），近侧的投影大、远侧小，屏幕上的密度自然降一半。
- **`material.opacity` 和 `size` 是全局的，逐粒子亮度只能每帧重写 color buffer。**
  `PointsMaterial` 只有一个 `size`，所以「有的像星星、有的像雾」只能靠
  `palette × bright × twinkle` 写进 `color` 属性。第二颗材质 = 第二次 draw call，更贵。
  亮点尾巴要又短又稀：6% 的 3.4 倍亮会把空角落点成噪点，眼睛先看到噪点，形状就没了。
- **歌词的卡拉 OK 走字靠 `onBeforeCompile`，不是每帧重画 canvas。** 2048×1024 的贴图
  是 8MB，60fps 上传就是每秒 0.5GB 的总线流量。canvas 里画满亮度的那一行，片元着色器
  用 `uWipe` 把行进线右侧的 alpha 乘到 `UNSUNG`；`band` 用 `abs(vMapUv.y - 0.5)` 把走字
  限制在活动行（活动行永远画在画布垂直正中），邻行不受影响。每帧只改一个 uniform。
  两个坑：片元里 uv 的 varying 名在 r152 之后是 `vMapUv`（不是 `vUv`），钩子要挂在
  `#include <opaque_fragment>` 之前；着色器编译失败只会让这块平面变黑，所以验证脚本
  必须收 `console.error`。
- **歌词平面宽 5.6 单位，机位 `lyrics` 的 `radius` 和它是一对。** 再近就切掉长句两端，
  再远字就小了。同理 `RING_Y` 是歌词平面的高度（`lyrics.js` 的 `BASE_Y`），
  `index.js` 在歌词打开时把鼠标射线打的那张平面也抬到这个高度 —— 不然光标指着歌词，
  洞却开在两米以下的地板上。`RING_Y` 从 `particles.js` 导出就是为这一处。
- **token 前缀是 `--t-`，且不引入任何 `--glass-*`。** 这一页只有深色，没有 `theme-dark`。
  `grep -n '\-\-glass' components/Music/three/` 必须是空的。
- **毛玻璃面板只能有三个**（徽标 / 列表 / 胶囊条）。桌面端的毛玻璃糊的是画好的色彩场，
  这里糊的是 **WebGL canvas** —— 每块都是对上一帧的回读，所以不能铺满全屏，也不能包住 canvas。
- **canvas 必须是浮层的兄弟，不能是它们的父节点。** 任何带 `backdrop-filter` 的元素
  包住 canvas，就会把 60fps 变成 20fps。
- **`.page::after`（暗角）必须 `pointer-events: none`**，否则它会变成光标下最上面那个元素，
  唱片就再也拖不动了。同理 `.top` 整条也是 `pointer-events: none` + 两个端点 `auto`。
- **`frame()` 读的是 ref，不是 props。** `ThreeStage` 把 state 塞进 `stateRef`，
  渲染循环每帧读它 —— 否则每 250ms 一次的 `timeupdate` 都会重建 renderer。
  `delta` 上限 50ms：切标签页回来那一帧的 `delta` 是秒级的，不夹住会让相机瞬移。
- **`row-active` 依旧只能叠加在 `row` 上**，不能二选一（同桌面端那条，布局全在 `.row` 上）。
- **唱片是平躺的**（桌面端是竖立的），所以倒影靠 `scale.y = -1` 的镜像 clone +
  一张 16×16 的光池遮住硬边，不用 `Reflector`：后者每帧为一张面重渲整个场景，
  而这个场景只有一件东西值得反射。镜像会**反转三角形绕序**，材质必须 `DoubleSide`。
- **倒影的 label 要单独上一次封面**：`mirror` 是在 `setCover` 之前 clone 的，
  所以 `record.js` 里有 `applyLabel()` 同时喂 `label` 和 `mirrorLabel`。
- **唱臂角度是解出来的，不是调的**：pivot `(0.9, -0.9)`、臂长 `0.78`，
  `|stylus|² = 1.273² + 0.78² − 2·1.273·0.78·cos θ`；θ=55° 是静止（出唱片）、
  42° 是导入槽、16° 是导出槽。改 `PIVOT` / `LENGTH` 就要重算这三个角。
- **封面必须走 canvas + `crossOrigin='anonymous'`**，不能用 `TextureLoader`：
  库里的封面是可能不存在的同名文件、Drive 缩略图会过期、R2 桶不一定带 CORS 头。
  `coverTexture(url, { fallback })` 会**先试真封面、失败再试渐变**（`makeArtwork`），
  两步都失败才返回 `null` —— 只试 fallback 不试原图，会让「有封面但加载失败」显示成黑标签。
- **歌词材质 `fog: false` + `toneMapped: false`**：它是被**读**的东西，
  雾会随距离压暗它、ACES 会把白色压成灰。别的材质都照常吃雾和色调映射。
- **粒子是主角，不是背景。** 这一页的视觉重心是「粒子 + 歌词」，唱片只是场景里的一件家具。
  粒子有**两种形态**，由 `formation`（0 星系 / 1 光环）在同一个 `position` attribute 上 damp 混合：
  星系是 24 个壳层差速旋转的扁盘（每帧只算 `SHELLS` 次三角函数，
  `cos(base+ωt)` 展开成 `cos·cos − sin·sin`），光环是立在歌词平面上的扁椭圆环。
  改形态不用改结构，只改 `formation`。
- **加色粒子必须 `toneMapped: false`。** 第一版是 1500 粒 0.03 单位 + ACES，
  曲线把每一个加色点压成灰斑 —— 场在那儿，谁也看不见。这一条和歌词材质那条同源。
- **粒子的颜色要够饱和。** 每个点都是加色画的，重叠处必然往白走，
  起点用 `#ff7d92` / `#a9c4ff` 这种淡色，加完就是一屏灰噪点；
  起手给到 `#ff4d6d` / `#5b8cff` 才留得住「近处暖、远处冷」。
- **光环必须整圈都在画面里，才读得出是环。** 第一版半径 2.6–4.4、压扁 0.34，
  椭圆 8.8×3.8，四边全部出框，看起来就是「满屏均匀的点」。
  内环现在收在 1.8–2.35、压扁 0.52，正好框住 5.6×2.8 的歌词平面，
  外面再放一圈更大更淡的外环（3–4.6）—— 内环负责「形状」，
  外环负责「纵深」：只有一圈的话，词是浮在虚空里的，眼睛判断不出那圈光离你多远。
  内环还是**有厚度**的（`RING_DEPTH` 1.2，是个环面不是平面圈），
  近侧投影大、远侧投影小，眼睛能把形状看两遍，屏幕上的密度也就降了一半。
- **`PointLight` 的距离是平方关系**（`decay: 2` ⇒ 照度 ∝ 1/d²）。
  节拍灯原来吊在唱片上方 0.62 处、`intensity 2.6`，比主光还亮，整个碟面被红洗成塑料。
  抬到 1.35、降到 0.7（运行时 `0.55 + level*2.6`）才对。红色轮廓光同理，
  `DirectionalLight(0xfa233b)` 从 1.5 降到 0.85 —— 它是给唱片**边缘**上色的，不是给碟面打底的。
- **`FRAMING.home` 的 `phi` 不能太小。** 尘埃盘躺在 y≈0 的地面上，
  `phi: 0.5` 时相机几乎与盘面齐平，整个星系退化成唱片后面的一条线；
  0.6 才既看得到盘面、又保得住唱片的构图。`FRAMING.lyrics` 则是 `5.4 / 0.34 / 1.82`——
  贴纸有 5.6 单位宽，比这更近就会把长句两头切掉。
- **只有歌词机位的距离跟着画面比例走**（`fitToAspect`）。`PerspectiveCamera`
  固定的是**垂直**视场角，窗口越窄横向能看到的世界单位越少：唱片和尘埃紧凑，
  窄窗口只是把房间裁掉一点；**歌词是 5.6 单位宽的平面，约束在横向上**。
  16:9 时横向可视 7.76 单位很宽裕，5:4 只剩 5.45（两头各切 0.07），
  **窗口吸到屏幕半边是 0.89，只有 3.88 单位 —— 长句每边丢一个字**，
  而这算很正常的用法。所以距离乘 `max(1, 16/9 / aspect)`，宽窗口一律不动
  （宽出来的地方本来就是「房间」）。改这块之前先用 `--size=WxH` 扫一遍窗口尺寸。
- **光标推开粒子用的是射线与地面平面的交点**（`stage.aim(x, y)`，落在 `RING_Y` 高度），
  不是屏幕坐标。这样同一套推开逻辑在扁盘和立环上都是对的，
  而且悬停（没按播放、没拖拽）也要调用 —— 不然鼠标划过是一片没有反应的空场。
- **`analyzer.js` 用的是裸 Web Audio，不是 `THREE.Audio`。** `THREE.Audio` 自带播放，
  而播放必须归 `core/PlayerAudio` 那个唯一 `<audio>` 所有（只有它能播 blob、
  报 `timeupdate`、跨路由存活）。这里要的是「接一根线」，对应的节点就是
  `MediaElementAudioSourceNode`。**一个元素只能建一次 source**（第二次抛
  `InvalidStateError`），所以图按元素存在模块级 `WeakMap` 里，重挂载时取回。
  挂不上（浏览器不支持 / 上下文起不来）就退到合成节拍（1.3Hz + 2.1Hz 两条正弦）——
  一个因为音频图失败而彻底僵住的场景看起来是坏的，一个按假节拍脉动的场景看起来是可视化。
- **`AudioContext` 延迟到第一次播放才建**，并 `resume()`：页面加载就建会以 suspended 起步
  且浏览器会告警，而从不按播放的访客根本不需要它。
- 从 `/desktop` 进 `/3d` 会**换一个 `<audio>` 元素**，歌会停一下；但 `usePlayer`
  会用 `LAST_TRACK_KEY` / `LAST_PROGRESS_KEY` 把同一首按原位置**重新载入**（不自动播放）。
  这条链路依赖列表缓存，所以第一次访问、列表还没落盘时不要期待能续上。

## 迁移时替换了什么

| 原（space 博客） | 现（本仓库） |
| --- | --- |
| `components/SEO`（依赖 i18n + 站点配置） | `core/PageHead.js` 里直接用 `next/head` 写 title/description |
| `config` 里的 `site` + `supportedLanguages` | 只保留 `site` + `music`，`title` 改成 `Music Space` |
| `shared.js` 里的 IndexedDB 代码 | 拆到 `lib/cache/indexedDb.js` + `components/Music/audioCache.js` |
| 挂在 `pages/music/` 下 | 改成根路径 `/`、`/h5`、`/desktop` |
| `utils/basePath.js` | **已删除** —— 唯一调用者是 SW 注册，SW 移除后无人使用 |
| 一个 `MusicApp` + `variant` 分支渲染两套布局 | 拆成 `h5/MusicApp` 与 `desktop/DesktopApp` 两棵独立的树，共用 `core/` |
| `@ybouane/liquidglass`（WebGL 玻璃） | **已卸载** —— 桌面端全部改成纯 CSS `backdrop-filter` |

## 常用命令

- `npm run dev` — 本地开发
- `npm run build` — 构建，产物在 `out/`
- `node scripts/preview-desktop-list.js` — 生成列表面板的可量尺寸预览页（先 `npm run build`）
- `node scripts/preview-covers.js` — 生成封面的可量尺寸预览页：列表/抽屉/缓存/唱片四种形状，每种都放了「有封面」和「没封面」两个对照
- `node scripts/preview-empty-list.js` — 生成空列表文案的预览页：四个分支两套布局并排，另附一列「旧写法（`<p>` 在 `<ul>` 里）」对照，量「消息是不是列表的兄弟节点、有没有真的画出来」
- `node scripts/drive-page.js <url> [--insecure] [--track=X] [--size=WxH] [--out=前缀]` — 用真 Chrome 打开页面并点一遍，报告 DOM 状态、失败请求和全部异常；有异常就非零退出。零依赖（Node 22 自带 `WebSocket`，直接说 DevTools 协议）
- `cd cloudflare-worker && npx wrangler deploy` — 部署曲库 Worker

### 要看「画出来是什么样」的时候

改 3D 场景、玻璃、布局这类**视觉**的东西，`npm run build` 只证明语法没坏。
要真的看一眼，别去量无头浏览器的 DOM —— 用 Junction 搭一个带真 basePath 的
本地 HTTP 根，再截图：

```bash
# .workbuddy-ai/serve/ 里三个 Windows Junction（New-Item -ItemType Junction）
#   music        -> out          于是 http://127.0.0.1:8899/music/3d/ 是真应用
#   node_modules -> 真实目录       importmap 能取到 three.module.js
#   components   -> 真实目录       能直接 import 未构建的 scene/*.js
python3 -m http.server 8899 --bind 127.0.0.1 --directory .workbuddy-ai/serve
chrome --headless=new --window-size=1440,810 --timeout=25000 \
       --screenshot=shot.png "http://127.0.0.1:8899/music/3d/"
```

三个坑，踩过就别再踩：

1. **`file://` 下 ES module 动态 import 一定失败**（不透明 origin），必须走 HTTP。
2. **页面里有活的 rAF 时 `--virtual-time-budget` 永不耗尽**，`--screenshot` /
   `--dump-dom` 会一直挂到超时。真页面用 `--timeout=N`；自己写的 harness
   则把循环写成有限步（跑 N 帧、渲染一次、停）。
3. **importmap 要补没有扩展名的裸相对导入。** `scene/lyrics.js` 里写的是
   `from './textures'`，浏览器不做扩展名补全 → 404，但报出来的错是
   `Failed to fetch dynamically imported module: .../lyrics.js` ——
   错误指向最外层那个模块，不是真正 404 的那个，很容易查错方向。

`scene/index.js` 是**可以脱离 React 一帧一帧驱动的**（`frame(delta, state)`），
所以除了单模块 harness，还能搭一个只 import `createStage` 的页面，
自己喂 200 帧 `{ playing, hasTrack, progress, lyricsVisible, lyrics, lyricsTime }`，
就能在无头浏览器里看到**完整构图**（唱片 + 唱臂 + 尘埃环 + 歌词）——
不用起 dev server，也不用等一首真歌。要看擦除在哪一刻是什么样，
就按时间跑（`?t=7.4`）而不是按帧数跑。

**判断「差得够不够」要读像素，不要靠眼睛。** 深色画面上的亮度差眼睛判不准
（歌词擦除那两半，肉眼看「好像差不多」，读回来是 252 对 84）。
把截图丢进一个 canvas 页、扫一条带里每列的最亮值、`--dump-dom` 取回来，
几行代码的事。

服务起在 `--directory` 上，**不要 `cd out`** —— 否则 `npm run build` 会因为
`EBUSY: rmdir 'out'` 失败（Windows 会把占用它的 python 进程锁住那个目录）。

### 但曲库的 CORS 只放行线上域名

上面那套环境里**列表永远是空的**：worker 回的是
`Access-Control-Allow-Origin: https://ianyspace.github.io`，`127.0.0.1` 读不到。
后果是所有依赖 `current` 的分支全部短路 —— 空列表、没有歌在放、没有封面、
没有歌词。**「构建绿 + 截图正常」在这个状态下什么也证明不了**，
线上点一首歌就崩的那个 bug 就是这么漏过去的。

要真的走一遍数据路径，用 CDP 驱动一个真浏览器，并给一个临时 profile
关掉同源策略：

```bash
# 线上：直接跑，什么都别加
node scripts/drive-page.js https://ianyspace.github.io/music/3d/ --track=夜曲

# 本地：必须 --insecure，否则列表是空的（见上）
node scripts/drive-page.js http://127.0.0.1:8899/music/3d/ --insecure --track=夜曲
```

`--insecure` 加的是 `--disable-web-security`，只在那个一次性 profile 里生效。
`--track=X` 点包含 X 的那一行而不是第一行 —— 值得用：**只有一部分歌有歌词**，
随便点一首多半走不到歌词那条路径。`--out=前缀` 会在每步存一张截图。

脚本打印每一步的 DOM 状态、所有 4xx/5xx 的真实 URL、以及**全部
`console.error` 和未捕获异常**，最后按「有没有异常」决定退出码，所以它也能当检查用。
异常是这套东西最值钱的产出：它给出压缩后的堆栈，对着 chunk 的字节偏移就能翻回
源码那一行 —— 上面那个点歌崩页的 bug 就是这么定位到 `ex` = `ThreeHud` 的。

两个坑：**URL 要放在 Chrome 命令行上，不要用 `Page.navigate`**（驱动空白页有竞态，
第一次探测会打在 `about:blank` 上，看到 `title: ""` 和空 DOM，然后误判成「页面是坏的」）；
**别用 `--screenshot` 代替它**，截图看不出「点了会不会崩」。

### 只想看一个 scene 模块，或者想量像素的时候

整页截图看不到细节，而且 `scene/*.js` 是纯 three.js、不依赖 React，所以
`.workbuddy-ai/lyrics-harness.html` 用 importmap 把 `three` 指到 `node_modules`，
直接 `import` 未构建的 `scene/lyrics.js` + `scene/particles.js`，自己摆机位、
自己喂一帧，**完全不需要 build**。参数走 query：

```bash
./probe.sh "t=7.4&form=1&probe=1"   # t=歌里的秒数 form=0星系/1环 cam=机位距离
```

`probe=1` 会把画好的帧读回来，按 64×28 的格子打印一张**每格亮起来的像素数**图。
这一步不是装饰：肉眼看一张小截图，分不清「一圈尘埃」和「均匀的噪点」，
而纯几何的投影模型又不知道雾、加色混合和点尺寸 —— 只有像素能仲裁。两个实现细节：

- 统计的是**每格超过背景色的像素个数**，不是每格最亮值。最亮值那张图永远是满的
  （5000 颗里总有一颗落在这一格），什么问题都答不了。
- 亮度台阶是**绝对**的（一级 = 该格 2% 的像素），不是按最亮格归一化 —— 归一化之后
  白字永远占满量程，尘埃全部落到 0，等于没测。

截图仍然要看，但它是最后一步：先用像素图确认形状成立，再用截图判断好不好看。

### 整场景也能免构建跑起来

`scene/index.js` 是框架无关的（接一个宿主元素、还回 `frame()` / `resize()` / `setCover()`），
所以 `.workbuddy-ai/scene-harness.html` 可以把它整个挂起来、用一段脚本化的 state 驱动：
渲染器、雾、PMREM 环境、四盏灯、唱片、唱臂、尘埃、歌词平面、机位全是**真的**，
只有外面那层 DOM chrome 是缺的。`?state=home|playing|lyrics`、`?t=`、`?cursor=x,y`（NDC）。

- **舞台尺寸要钉死成 16:9。** 无头 Chrome 的 `--window-size` 不等于视口高度
  （给 720 实际只有 566），`inset: 0` 于是得到一个 2.2:1 的帧 —— 那个比例下尘埃环
  看起来比真实屏幕上稀得多，会把人骗去改本来没错的几何。
- **`analyzer` 有合成节拍兜底**（两个慢正弦），所以没有 `<audio>` 也能跑，
  节拍驱动的光、尘埃、FOV 呼吸都照常动。这正好也是浏览器给不出 Web Audio 时线上的样子。
- 软件渲染下每帧都很贵：`?step=0.05`（默认 1/30）配 `t<10` 才够快，
  跑 `t=40` 会直接超时。`MathUtils.damp` 是帧率无关的，粗步长不影响最终状态。
- **相机方位角要留活口**：`state=lyrics` 时不要调 `hold()`，否则那个「转向歌词」
  的阻尼被空闲计时器挡住，测不出东西来。
- **`?cursor=` 要给够帧数**：`stage.aim()` 打的射线落在 `aimY` 那张平面上，而 `aimY`
  是从地板阻尼升到歌词高度的（lambda 2）。只跑四五帧，射线还在地板上，洞开在两米以下，
  看起来就像「斥力没生效」。

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
