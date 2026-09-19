# music — 项目约定

独立出来的音乐播放器（Next.js 15 Pages Router + Sass），**仓库根目录即项目**，
构建为静态导出后发布到 GitHub Pages 项目页：https://ianyspace.github.io/music/

代码从博客仓库 `space` 的 `components/Music/` + `pages/music/` 整体切出，
播放逻辑一行没改，只替换了三个博客专有的依赖（见下方「迁移时替换了什么」）。

**`/h5` 与 `/desktop` 是两棵完全独立的组件树**：彼此不 import 任何一个文件，
只共用 `components/Music/core/`（状态机 + 数据层 + 面板内容）和它旁边的纯函数。
桌面端的每一个面都是**纯 CSS 毛玻璃**（`backdrop-filter` + `--glass-*` token），
没有任何 WebGL / 玻璃库依赖。详见下方「两套布局」。

## 目录

| 路径 | 作用 |
| --- | --- |
| `pages/index.js` | 入口路由，按屏宽决定跳 `/h5` 还是 `/desktop` |
| `pages/h5.js` / `pages/desktop.js` | 两个薄路由，各自只渲染一棵树，互不相干 |
| `components/Music/h5/` | 手机端：`MusicApp` 外壳 + 列表/播放页/迷你条/我的 + 三个底部面板 |
| `components/Music/desktop/` | 宽屏端：`DesktopApp` 外壳 + 沉浸式舞台（`DesktopMusic`）+ 玻璃弹窗 + 行抽屉 |
| `components/Music/core/` | 两套布局共用的中性核心（见下方「两套布局」） |
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
- **两棵树不许互相 import**：`components/Music/h5/**` 里不许出现 `desktop`，
  反之亦然。共用的东西只能落在 `components/Music/core/` 或 `components/Music/` 根下。
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

## 两套布局

```
pages/h5.js ──────▶ components/Music/h5/MusicApp.js ─────┐
                                                          ├─▶ components/Music/core/
pages/desktop.js ─▶ components/Music/desktop/DesktopApp.js ┘   + Cover/Marquee/icons/
                                                                shared/audioCache/librarySource
```

两棵树之间**没有任何 import**。`/h5` 里没有一行代码知道桌面端存在，反之亦然。
共用部分按职责分三块：

| `core/` 文件 | 是什么 | 为什么放这儿 |
| --- | --- | --- |
| `usePlayer.js` | 全部播放状态：曲库、缓存、歌词、Google、主题、抽屉开关 | 两套布局要共享**行为**，且必须逐字一致 |
| `PageHead.js` | `<Head>` 标题 + GSI `<Script>` | 两个页面都要有同样的 title 和同一份 GSI 加载错误文案 |
| `PlayerAudio.js` | 那唯一一个 `<audio>` | 六种 handler 由 `usePlayer` 统一返回，少接一个就是「进度条永远不动」且不报错 |
| `CacheContent.js` / `DislikedContent.js` | 缓存管理 / 不喜欢歌曲的**内容** | 两个面板的**外壳**不同（底部抽屉 vs 玻璃卡片），内容相同 |
| `sheetBase.module.scss` | `.body` / `.state` | 面板内容共用的滚动容器与加载文案 |

**面板一律「内容 + 外壳」两半**：内容在 `core/`，外壳各自实现
（`h5/SheetChrome.*` 是底部升起的抽屉，`desktop/DesktopSheetChrome.*` 是居中的玻璃卡片）。
内容组件返回的是 **Fragment**，因为外壳是个 flex column，它那几块要当直接子节点才能保住
`flex-shrink: 0` / `flex: 1`。

`usePlayer` 返回一个扁平的 ~80 字段对象（而不是拆成几个小 hook），就是为了让这次拆分
能**逐字搬迁**手机端的行为 —— 拆 hook 会顺手改掉依赖数组和执行顺序。

`lyricsAutoOpen` 是两套布局**唯一**真正分歧的地方：桌面端的舞台就是歌词，
有歌词就展开是对的；手机端则会平白盖住自己的列表。

桌面端列表还有一条手机端没有的规则：**有歌在放、鼠标又不在列表上，3 秒后列表自己收起**
（`LIST_HIDE_MS`）。它折的是 `autoHidden`，不是 `listOpen` —— 后者是访客的选择、
是要存进 localStorage 的那个；前者只是播放器替访客做的临时决定，所以暂停、搜索、
开着菜单、鼠标回到列表上都会立刻把它放回来。写这个 effect 时依赖必须是**布尔量**
（`hasCurrent` 而不是 `current`）：`current` 每次渲染换身份的话，定时器会被反复
清掉重设，列表就永远不会收起。

**改一套布局时先想另一套**。以前这个缝漏过三次：`置顶` / `移入不喜欢` 只接在手机端；
桌面端用 Google token 而不是 `hasLibrary` 判空状态，导致公共曲库明明加载好了却显示
「曲库里还没有歌曲」；`回到正在播放` 长在手机端迷你条上，桌面端根本没有。
现在两套是独立文件，漏了更不会报错 —— 只是那一套「没有这个功能」而已。

### 桌面端的毛玻璃

**纯 CSS，没有 WebGL，没有玻璃库**（原来的 `@ybouane/liquidglass` 已卸载）。
一个「玻璃面」就是四件事：半透明填充 + 发丝描边 + 内高光 + `backdrop-filter`。

token 只在**一处**声明：`desktop/DesktopApp.module.scss` 的 `.page`（浅色）和
`.page.theme-dark`（深色）。`DesktopMusic.module.scss`、`DesktopSheetChrome.module.scss`
以及 `core/` 的内容组件全部只**消费**、不声明 —— 一个定义，工作台和外壳就不可能各走各的。

| token | 用途 |
| --- | --- |
| `--glass-blur` / `--glass-sat` | `backdrop-filter: blur() saturate()` 的两个参数 |
| `--glass-bg` | 常规面：胶囊播放条、设置按钮、折叠后的列表开关 |
| `--glass-bg-soft` | 玻璃**之上**的凹陷（搜索框、输入框、设置里的曲库卡片） |
| `--glass-bg-strong` | 要压住繁忙内容的面：菜单、设置弹窗、面板卡片、toast、定位按钮 |
| `--glass-border` / `--glass-inset` / `--glass-shadow` | 描边、内高光、投影 |

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
│     ├── .stage-record         唱片 + 歌名（有歌词时 opacity: 0，不卸载）
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
- **胶囊播放条的几何写在 `.root` 上**（`--bar-h` / `--bar-bottom`），
  因为 `.side` 的底边要用它来让开播放条。改一个数字，两处一起动。
- **`.seek` 是绝对定位在胶囊内部的**（贴着下沿、左右各让开 34px）：
  胶囊的圆角是 999px，行内边距小于 34px 时内容会跑到填充外面去。
- 列表的 `.list` 带 `mask-image` 下沿渐隐 —— 它是浮在色场上的，硬切会被读成「面板被裁了」。
- **唱片的宽度要自己让开列表那一列**：
  `min(56vh, 44vw, 700px, calc(100vw - 2 * var(--side) - 56px))`。
  `44vw` 不够 —— 它量的是整个视口，而唱片是居中在视口里的，所以「窄而高」的窗口
  （1920×1080 屏左右分屏后就是 960×1040）会让 `56vh` 把唱片撑到左缘滑进列表下面
  （900×1000 实测 −19px）。最后那一项按 `--side` 在两侧各留一列，保证行与唱片之间
  恒有 40px；它在 ~1340px 宽以上不会生效，所以常见尺寸一点没变。

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
