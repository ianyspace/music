# space-music Worker

把 Cloudflare R2 桶暴露成 `/music/` 页面可用的曲库清单，并用 D1 存「谁听了哪首歌、
听了多少次」和「谁喜欢了哪些歌」。因为站点是 GitHub Pages 静态导出，浏览器无法自己
列举 R2，所以由这个 Worker 提供清单；音频本身走 R2 公开域名直链下载。播放次数和喜欢
同理：静态页面没法写数据库，写和读都经过这个 Worker。

## 接口

| 请求 | 说明 |
| --- | --- |
| `GET /tracks` | 返回 `{ tracks: [...], generatedAt }`，清单在边缘缓存 300 秒 |
| `GET /tracks?refresh=1` | 绕过缓存，强制重新列举 R2（上传新歌后立即生效） |
| `POST /plays` | 写入一批播放事件，body `{ qq, plays: [{ eid, id, name, at }] }` |
| `GET /stats?qq=…` | 返回该 QQ 的排行：全部 + 最近 7 天 |
| `GET /likes?qq=…` | 返回该 QQ 的喜欢列表，新的在前 |
| `POST /likes` | 增 / 删喜欢，body `{ qq, add: [{ id, name }], remove: [id] }` |

单个曲目：

```json
{
  "id": "songs/牵丝戏-银临.mp3",
  "key": "songs/牵丝戏-银临.mp3",
  "name": "牵丝戏-银临.mp3",
  "size": 8421376,
  "url": "https://music-cdn.example.com/songs/%E7%89%B5%E4%B8%9D%E6%88%8F-%E9%93%B6%E4%B8%B4.mp3",
  "lyricsUrl": "https://music-cdn.example.com/songs/%E7%89%B5%E4%B8%9D%E6%88%8F-%E9%93%B6%E4%B8%B4.lrc",
  "coverUrl": "https://music-cdn.example.com/songs/%E7%89%B5%E4%B8%9D%E6%88%8F-%E9%93%B6%E4%B8%B4.jpg",
  "source": "cloud"
}
```

- 只列出音频扩展名：`mp3` `flac` `m4a` `wav` `ogg` `oga` `opus` `aac` `wma` `ape`
- **清单按「加进来的时间」倒序，新的在前**（`uploaded`，也就是对象写进桶的时间）。
  桶里没有别的「什么时候加的」可用：没有附带索引，D1 里也没有每首歌一行。
  同一毫秒的（一次批量上传就是这种）按**文件名**排，所以顺序是可复现的 ——
  桶的列举顺序不是谁选的，`Array#sort` 稳定只保证「从输入可复现」。
  排序在 Worker 里做而不是前端：前端只能按**响应里带的字段**排，而边缘缓存会在部署后
  继续发最多 5 分钟的旧响应，那时整个清单的该字段都是空的，列表会毫无理由地自己重排。
- 同名 `.lrc` / `.txt` 会作为歌词挂在 `lyricsUrl`（忽略扩展名、空格、点、连字符和开头的序号，
  例如 `01. 牵丝戏 - 银临.mp3` 能匹配 `牵丝戏-银临.lrc`）
- 同名图片会作为封面挂在 `coverUrl`（`jpg` `jpeg` `png` `webp`，匹配规则同上，
  例如 `01. 牵丝戏 - 银临.mp3` 能匹配 `牵丝戏-银临.jpg`）
- `lyricsUrl` / `coverUrl` 没有对应文件时是 **`null`，不是省略字段**：前端把「没有这个字段」
  理解成「这个清单还不认识封面」，会退回自己按 `.jpg` 猜名字（每首没有封面的歌白费一个 404）。
  所以别把它们删掉。
- 加封面要**重新部署 Worker** 才生效；已经部署的旧版本不会返回 `coverUrl`。

## 播放次数（D1）

播放次数存在 **D1**（Cloudflare 的 SQLite），表结构在 `schema.sql`：

```sql
plays(event_id PRIMARY KEY, qq, track_id, track_name, played_at, created_at)
```

四个设计决定，改之前先看一眼：

- **`event_id` 是主键，不是自增 id。** 客户端在播放时先把事件写进本机日志，等服务端
  确认后才删；所以同一批数据可能到达两次（响应丢了、两个标签页同时同步）。服务端用
  `INSERT OR IGNORE`，重发就是空操作 —— 没有这一条，重试会直接虚增次数，而次数正是
  这个功能的全部内容。
- **一次请求就是一个事务**（`db.batch`）。要么整批落库、要么客户端留着下次重发，
  不会出现「一半进去了」这种要靠人去对账的状态。
- **`played_at` 是客户端时间**（访客什么时候听的），`created_at` 是落库时间。设备时钟
  离谱到不在「2001 年之后、明天之前」这个区间里的，按当前时间记 —— 丢掉这条记录比
  记一个假时间更糟。
- **建表语句一条一条地跑，用 `batch` 而不是 `exec`。** D1 绑定的 `exec()` **不吃多语句
  字符串** —— 它把整串丢给 SQLite，然后回 `D1_EXEC_ERROR: incomplete input`。第一次部署
  就是这么挂的。`batch` 收的是 prepare 过的语句，一次事务、一次往返，而且每条都是
  `IF NOT EXISTS`，重复跑不花钱。`schema.sql` 是同一份 DDL，`wrangler d1 execute --file`
  那条路**能**跑多语句（它自己会拆），所以两边都得留着，改一处记得改另一处。
- **没有鉴权，这是有意的。** QQ 号是访客给自己头像起的名字（见 `components/Music/shared.js`
  的 `normalizeQq`），不是一个能验证的凭据，所以 `GET /stats` 回答的是「这个号码听过什么」，
  而不是「证明你是这个号码」。知道号码的人就能看到它的排行 —— 和知道号码就能取到它的头像
  一样。真要保护，得先有登录，不是在这里加一个参数。

客户端那一侧（本机日志、非阻塞上报）在 `components/Music/playStats.js`，
手动「同步」按钮在 `components/Music/h5/useDataSync.js`（和喜欢共用一颗）。

## 我喜欢（D1）

喜欢同样存在 D1，同一份 `schema.sql`：

```sql
likes(qq, track_id, track_name, created_at, PRIMARY KEY (qq, track_id))
```

**主键是 `(qq, track_id)`，所以「喜欢」天然幂等** —— `INSERT OR IGNORE` 重发多少次都
只算一次，取消就是一条 `DELETE`。这和 `/plays` 的 `event_id` 是同一类想法（重发不能改变
结果），但形状不同：一次播放是一件**发生过的事**（要记 N 次），一次喜欢是一个**状态**
（只关心最后是哪个），所以这边不需要客户端生成 id。

- **一次请求就是一个事务**（`db.batch`）：`add` 和 `remove` 一起提交，不会出现
  「加了一半、删了一半」那种要靠人对账的中间态。响应里的 `changed` 是真正生效的行数，
  重发时为 0，这就是「服务端确实收到过」的凭据。
- **两个数组都按 `MAX_LIKES_PER_REQUEST`（500）截断**。客户端必须用同样的值分批
  （`likes.js` 的 `BATCH_SIZE`）：服务端对超出的部分**照样回 200**，客户端于是把整批
  标成「已确认」再删掉 —— 多出来的那些就静默丢了。和 `/plays` 那对常量（200）是
  **分开的两对**，改一对不要以为另一对跟着变。
- **`GET /likes` 也走 `Cache-Control: no-store`**：喜欢是每个号码自己的，被边缘缓存
  就等于把一个人的列表端给另一个人看。
- **同样没有鉴权，同样是有意的**（理由见下一条）。

### 建库

```bash
npx wrangler d1 create space-music-plays
npx wrangler d1 execute space-music-plays --remote --file schema.sql
```

`d1 create` 会打印 `database_id`，把它填进 `wrangler.toml` 的 `[[d1_databases]]`
（占位符没换掉的话 `wrangler deploy` 会直接拒绝这个绑定）。

Worker 自己也会在第一次写入前跑一遍同样的 DDL（`ensureSchema`，用 `db.batch`，
`schemaPromise` 缓存住结果），所以忘了这一步的新部署会自己补上；`schema.sql` 是
「它建了什么」的记录，而不是一个漏了就坏掉的步骤。**加一张新表不需要额外的部署步骤**
（`likes` 就是这么加上去的），但第一次调用会慢一点。两边记得同步改。

## 当前部署（本仓库）

| 项 | 值 |
| --- | --- |
| R2 桶 | `space` |
| 公开域名 | `https://pub-5fd69e65dbb64faca6f6a164b495d7ba.r2.dev`（r2.dev 子域） |
| Worker 名 | `space-music` |
| Worker 地址 | `https://space-music.ianyscript.workers.dev`（`config/index.js` 的 `music.workerUrl`） |
| D1 数据库 | `space-music-plays`（绑定名 `PLAY_DB`，`database_id` 已填在 `wrangler.toml`） |

改动公开域名（比如换成自定义域）后，记得同步 `wrangler.toml` 的 `R2_PUBLIC_BASE` 并重新
`npx wrangler deploy`，否则清单里返回的还是旧地址。

## 环境要求

- **Node 版本**：`wrangler@4` 需要 **Node >= 22**。本机是 Node 20 的话，用 `wrangler@3` 部署
  （本项目已把 `compatibility_date` 固定在 wrangler 3 也接受的值）。
- 如果 `npx wrangler` 报 `ENOTEMPTY` / `EPERM` / `不是内部或外部命令`，是 npx 缓存目录损坏，
  清掉后改用全局安装：

  ```bash
  npm cache verify
  npm i -g wrangler@3
  cd worker
  wrangler login
  wrangler deploy
  ```

- 完全不想装工具链，也可以直接在 Cloudflare Dashboard 里建 Worker（Workers & Pages →
  Create → Worker），把 `src/index.js` 粘贴进去，再补上 `MUSIC_BUCKET` 绑定与
  `R2_PUBLIC_BASE` / `ALLOWED_ORIGINS` 两个变量即可。

## 部署步骤

1. 创建桶并上传音乐（保持文件名格式，例如 `牵丝戏-银临.mp3` 与同名 `.lrc`）。

   ```bash
   npx wrangler r2 bucket create space-music
   npx wrangler r2 object put space-music/牵丝戏-银临.mp3 --file ./牵丝戏-银临.mp3
   ```

2. 给桶开一个公开访问域名（R2 → bucket → Settings → Public access）：
   - 快速方案：开启 `r2.dev` 子域，得到形如 `https://pub-xxxx.r2.dev`
   - 推荐方案：绑定自定义域，形如 `https://music-cdn.example.com`（可接 Cloudflare 缓存）

3. **配置 CORS（必须）**。前端为了做 7 天离线缓存，是用 `fetch` 下载音频成 Blob 再写进
   IndexedDB 的，所以公开域名必须允许跨域读取，否则表现为「列表能出来、点击播放没反应」。
   在 bucket 的 CORS policy 里加入：

   ```json
   [
     {
       "AllowedOrigins": ["https://ianyspace.github.io", "http://localhost:3000"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["Content-Length", "Content-Type"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

4. 编辑 `wrangler.toml`：
   - `R2_PUBLIC_BASE` 填第 2 步的公开域名（不要带结尾斜杠）
   - `ALLOWED_ORIGINS` 填允许读取清单的来源
   - `MUSIC_PREFIX` 可选，只想暴露某个前缀时填写
   - `[[d1_databases]]` 的 `database_id` 填 `d1 create` 打印的那个（见上方「建库」）

5. 部署：

   ```bash
   cd worker
   npx wrangler deploy
   ```

   得到形如 `https://space-music.<subdomain>.workers.dev` 的地址。

6. 把该地址写入站点配置 `config/index.js` 的 `music.workerUrl`
   （或用环境变量 `NEXT_PUBLIC_MUSIC_WORKER_URL` 覆盖），然后重新构建部署博客。

## 本地联调

```bash
cd worker
npx wrangler dev
```

默认监听 `http://localhost:8787`，可先直接验证：

```bash
curl "http://localhost:8787/tracks?refresh=1"

# 播放次数：写一条再读回来（本地 D1 是 wrangler 起的那个，不用 --remote）
curl -X POST http://localhost:8787/plays \
     -H 'Content-Type: application/json' \
     -d '{"qq":"10001","plays":[{"eid":"test-1","id":"songs/牵丝戏-银临.mp3","name":"牵丝戏-银临.mp3","at":1730000000000}]}'
curl "http://localhost:8787/stats?qq=10001"

# 喜欢：加一首、读回来、再删掉
curl -X POST http://localhost:8787/likes \
     -H 'Content-Type: application/json' \
     -d '{"qq":"10001","add":[{"id":"songs/牵丝戏-银临.mp3","name":"牵丝戏-银临.mp3"}]}'
curl "http://localhost:8787/likes?qq=10001"
curl -X POST http://localhost:8787/likes \
     -H 'Content-Type: application/json' \
     -d '{"qq":"10001","remove":["songs/牵丝戏-银临.mp3"]}'
```

再让页面指向它：设置 `NEXT_PUBLIC_MUSIC_WORKER_URL=http://localhost:8787` 后启动 `npm run dev`
（`config/index.js` 也允许直接改默认值）。

## 安全姿态（改这个 Worker 之前先读）

**写接口没有鉴权，这是有意的** —— QQ 号是访客给自己头像贴的标签，不是凭据，
没有东西可以验证它。所以这里的每个"风险"都不是 bug，是那个决定的代价。
但代价要写清楚，免得下次有人以为它是漏洞、或者以为它不存在：

- **`POST /plays` / `POST /likes` 谁都能打。** 别指望 `ALLOWED_ORIGINS`：它只是回给浏览器的
  响应头，curl 和任何非浏览器客户端完全不受约束（实测带 `Origin: https://evil.example`
  照样 200）。**所以不要往这个方向加防御，它提供的是假的安全感。**
- **知道 QQ 号就能读那个人的听歌历史与喜欢**（`GET /stats` / `GET /likes`）。
- **知道 QQ 号就能删掉那个人的喜欢。** `POST /likes` 的 `remove` 是
  `DELETE FROM likes WHERE qq=? AND track_id=?` —— **这是整个系统里唯一能造成
  "别人的东西没了"的操作**，比塞垃圾严重。要根治只能加鉴权，那等于换掉上面那个决定。
- **没有限流** → 一次请求能写 200 行，免费版 D1 日写入是十万行量级，
  **几百个请求就能打满，之后真实用户的播放和喜欢静默记不上**（客户端堆在本地，
  界面显示「本地还有 N 条数据没上传」）。症状不指向攻击，这是它最讨厌的地方。

### 唯一必须做的运维动作：给写接口限流

代码里做不到（Worker 没有可用的跨 isolate 计数器），要用 Cloudflare 面板的
**Security → WAF → Rate limiting rules**（免费版有额度）。建议：

| 项 | 值 |
| --- | --- |
| 匹配 | `http.request.uri.path in {"/plays" "/likes"}` |
| 特征 | IP |
| 阈值 | 60 次 / 1 分钟 |
| 动作 | Block，1 分钟 |

再顺手开一下 **Bot Fight Mode**（Security → Bots，免费）。这两条加起来能把上面
"打满配额"和"批量删别人的喜欢"的成本抬高几个量级。**面板文案会变，按意图配。**

### 代码里已经有的三道

- **`?refresh=1` 有 15 秒冷却**（`withinRefreshCooldown`）：强制刷新要重新列一遍整个桶，
  而它同样无鉴权，所以这是唯一能放进代码的天花板。冷却期内降级成读缓存 ——
  而缓存里那份至多 15 秒旧，比平时 300 秒的 TTL **更新**，所以被降级的访客没被糊弄。
- **502 不再回显 `error.message`**：D1/R2 的报错带表名、绑定名和 SQL 片段，
  外面的人拿到没用，探测的人拿到是白送的。细节进 `console.error`（`wrangler tail` 看）。
- **每个响应都带 `X-Content-Type-Options: nosniff`**：统一在 `withHeaders` 里加，
  缓存 HIT 那条路径单独补一次（老部署写进边缘缓存的条目还没这个头，最多残留 300 秒）。
  它买的是「浏览器不会无视我们的 `Content-Type` 去猜正文」——
  也就是把下面那条存储型 XSS 的第二道门堵上。

### 一条给未来的警告（现在不是漏洞）

**存储型 XSS 的形状已经齐了**：这里有个开放写入口，而 `track_name` 会被 `/stats`
回显、渲染在「听歌排行」里。现在不成 XSS，只因为 React 把文本节点转义了。
**谁哪天把歌名或歌词换成 `dangerouslySetInnerHTML`，这个写入口立刻变成存储型 XSS。**
两个各自没问题的地方撞出来的，改前端渲染时要记得这边是开放的。

## 注意

- 清单缓存 300 秒；上传新歌后想立刻看到，用 `?refresh=1` 或等 5 分钟
- Worker 只读清单，不代理音频流量；音频带宽走 R2 公开域名
- 桶是公开的，任何知道 URL 的人都能下载音频，曲库等同公开资源
- `/plays` / `/stats` / `/likes` 一律 `Cache-Control: no-store`：排行和喜欢是每个访客
  自己的数字，被边缘缓存就等于把一个人的数据端给另一个人看
- 绑定 D1 之后 `wrangler dev` 默认用**本地**数据库；要连线上那份加 `--remote`
