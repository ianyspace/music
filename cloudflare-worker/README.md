# space-music Worker

把 Cloudflare R2 桶暴露成 `/music/` 页面可用的曲库清单，并用 D1 存「谁听了哪首歌、
听了多少次」。因为站点是 GitHub Pages 静态导出，浏览器无法自己列举 R2，所以由这个
Worker 提供清单；音频本身走 R2 公开域名直链下载。播放次数同理：静态页面没法写数据库，
写和读都经过这个 Worker。

## 接口

| 请求 | 说明 |
| --- | --- |
| `GET /tracks` | 返回 `{ tracks: [...], generatedAt }`，清单在边缘缓存 300 秒 |
| `GET /tracks?refresh=1` | 绕过缓存，强制重新列举 R2（上传新歌后立即生效） |
| `POST /plays` | 写入一批播放事件，body `{ qq, plays: [{ eid, id, name, at }] }` |
| `GET /stats?qq=…` | 返回该 QQ 的排行：全部 + 最近 7 天 |

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
- **没有鉴权，这是有意的。** QQ 号是访客给自己头像起的名字（见 `components/Music/shared.js`
  的 `normalizeQq`），不是一个能验证的凭据，所以 `GET /stats` 回答的是「这个号码听过什么」，
  而不是「证明你是这个号码」。知道号码的人就能看到它的排行 —— 和知道号码就能取到它的头像
  一样。真要保护，得先有登录，不是在这里加一个参数。

客户端那一侧（本机日志、非阻塞上报、手动同步）在 `components/Music/playStats.js`。

### 建库

```bash
npx wrangler d1 create space-music-plays
npx wrangler d1 execute space-music-plays --remote --file schema.sql
```

`d1 create` 会打印 `database_id`，把它填进 `wrangler.toml` 的 `[[d1_databases]]`
（占位符没换掉的话 `wrangler deploy` 会直接拒绝这个绑定）。

Worker 自己也会在第一次写入前跑一遍同样的 DDL（`ensureSchema`），所以忘了这一步的
新部署会自己补上；`schema.sql` 是「它建了什么」的记录，而不是一个漏了就坏掉的步骤。
两边记得同步改。

## 当前部署（本仓库）

| 项 | 值 |
| --- | --- |
| R2 桶 | `space` |
| 公开域名 | `https://pub-5fd69e65dbb64faca6f6a164b495d7ba.r2.dev`（r2.dev 子域） |
| Worker 名 | `space-music` |
| Worker 地址 | `https://space-music.ianyscript.workers.dev`（`config/index.js` 的 `music.workerUrl`） |
| D1 数据库 | `space-music-plays`（绑定名 `PLAY_DB`，`database_id` 填在 `wrangler.toml`） |

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
```

再让页面指向它：设置 `NEXT_PUBLIC_MUSIC_WORKER_URL=http://localhost:8787` 后启动 `npm run dev`
（`config/index.js` 也允许直接改默认值）。

## 注意

- 清单缓存 300 秒；上传新歌后想立刻看到，用 `?refresh=1` 或等 5 分钟
- Worker 只读清单，不代理音频流量；音频带宽走 R2 公开域名
- 桶是公开的，任何知道 URL 的人都能下载音频，曲库等同公开资源
- `/plays` 与 `/stats` 一律 `Cache-Control: no-store`：排行是每个访客自己的数字，
  被边缘缓存就等于把一个人的次数端给另一个人看
- 绑定 D1 之后 `wrangler dev` 默认用**本地**数据库；要连线上那份加 `--remote`
