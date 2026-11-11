# gogogo 1.0

基于小红书公开页面证据生成随性出游方向的网页应用。Node 服务提供网页、API、用户会话与运行记录；Python + Playwright 在部署机器上读取小红书登录会话。每个部署者自行配置模型接口、邀请码和小红书账号；仓库不包含任何可用凭证或历史用户数据。

## 从 GitHub 克隆后启动

要求：Node.js 24+、Python 3、Chrome（Windows）或 Playwright Chromium（Linux）。在项目根目录执行：

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
Copy-Item .env.example .env
```

编辑本机 `.env`：至少填入一个随机且仅自己知道的 `TRIAL_INVITE_CODES`，服务才能启动；若要提供站点模型，还要填写 `DEEPSEEK_API_KEY`。默认模型地址和模型名是示例配置，需按实际账号可用的 API 调整。部署者也可不设置站点模型 Key，让使用者在设置页填写自己的兼容 Chat Completions 的 HTTPS 接口；“自带 API”模式不需要输入邀请码。需要其他接口域名时，将其加入 `MODEL_ALLOWED_HOSTS`。

首次使用需在**运行服务的机器上**登录小红书：

```powershell
python xhs_connector.py login
python xhs_connector.py status
npm start
```

浏览器扫码完成后，登录会话默认存入 `data/xhs_cookies.json`。请勿上传或分享该文件。服务默认在 `http://127.0.0.1:3001/`；打开设置页选择邀请码模式或自带 API 模式。当前同一部署实例的所有使用者共用部署者的小红书会话，不能在网页中分别登录自己的小红书账号。会话失效时，部署者重新执行登录命令。Windows 默认使用系统 Chrome；Linux 需先安装 Chromium 及系统依赖（见下方部署说明）。

运行 `npm test` 可做离线测试，不需要小红书登录或模型 API。公网部署与数据保管说明见下方“服务器部署准备”。

## 发布范围

GitHub 仓库只包含应用源码、静态资源、测试、配置模板及部署示例。`.env`、`data/`（Cookie、数据库、缓存及用户输入）、`tools/`（本机下载工具和日志）、`eval/`（评测数据）被 Git 忽略。克隆者需要各自创建 `.env`、登录小红书，并配置自己的 API 和部署环境。发布前请检查 `git status` 和暂存文件清单，避免手动强制添加上述文件。

# 小红书数据模块

## 封闭试用数据与身份

### 不租服务器的临时试用

在 Windows 本机安装好 Node 24+、Python 依赖并配置 `.env`、小红书 Cookie 后，从 [Cloudflare 官方下载页](https://developers.cloudflare.com/tunnel/downloads/)获取最新的 `cloudflared-windows-amd64.exe`，放到 `tools/cloudflared.exe`。运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_trial_tunnel.ps1
```

命令输出的 `https://…trycloudflare.com` 即试用链接，知道链接的人可以直接打开。使用站点模型 Key 仍需在设置页输入邀请码；自带 API 模式填写自己的接口配置。两种模式共用本机的小红书 Cookie，因此仅把链接发给信任的试用者。若要额外限制访问，可在启动命令末尾加上 `-AllowedMail '测试者@example.com'`，多个邮箱用英文逗号分隔，访问时需通过邮箱一次性验证码。保持电脑联网、此终端开启，临时链接才能访问。重启后需重新运行命令并分发新链接；SQLite 数据库和搜索缓存仍保留在本机 `data/` 中。Cloudflare Quick Tunnel 适合小批量测试，没有在线时长保证，也不提供固定域名。正式长期运行请使用下方服务器方案。

### 服务器部署准备

同一个 Node 服务现在提供网页和 `/api`，网页默认请求当前域名，无需在前端填写服务器 IP。安装 Node 24+、Python 及 `requirements.txt` 后，在 Linux 服务器执行 `python -m playwright install --with-deps chromium` 安装无界面浏览器。设置 `HOST=127.0.0.1`、`PORT=3001`，由 HTTPS 反向代理把域名转发到此端口；不要直接将此端口开放给公网。可按 [Caddyfile 示例](deploy/Caddyfile.example) 配置 HTTPS，并参考 [systemd 服务示例](deploy/gogogo.service.example) 设置运行用户和工作目录；示例中的域名、路径和 Node 路径需按服务器实际情况替换。

当前所有试用者共用一份小红书登录会话。先在本机通过 `python xhs_connector.py login` 获取 Cookie，再通过安全方式放到服务器的私有持久化目录，并用 `XHS_COOKIE_FILE` 指向该文件。连接器在 Linux 默认使用 Playwright 安装的 Chromium；如需指定浏览器，设置 `XHS_BROWSER_PATH`。Cookie 文件必须仅允许运行服务的系统用户读取，不能放进 `web/` 或代码仓库。会话失效时，需要重新获取并替换文件，然后重启 Node 服务，使 Python 工作进程重新加载 Cookie。

本地开发可直接打开 `http://127.0.0.1:3001/`，项目介绍是首页，点击“GO！”进入 `/explore.html` 输入页；正式访问使用反向代理配置的 HTTPS 域名。缓存演示模式使用 `/explore.html?cached=1` 和原独立演示服务。

正式启动服务前，在 `.env` 中设置 `TRIAL_INVITE_CODES`，用英文逗号分隔，每位邀请码用户分配**不同**的码。Node 24+ 内置 SQLite；`npm start` 会创建 `data/trial.sqlite`，保存用户、7 天应用会话、运行归属和各阶段快照。可用 `TRIAL_DB_PATH` 指定数据库位置。没有邀请码时正式服务会拒绝启动。用户在独立的 `/settings.html` 页面选择使用邀请码（使用服务端模型 Key）或使用自己的兼容 Chat Completions 的接口，并填写 HTTPS URL、模型 ID、API Key。自带配置保存在当前浏览器标签页的 `sessionStorage`，每次模型请求通过 HTTPS 传至服务端，不写入数据库。服务端默认只允许 `api.deepseek.com` 和 `api.openai.com`，可通过 `MODEL_ALLOWED_HOSTS` 增加可信接口域名，以防服务器被用来访问任意地址。两种模式都共用服务器的小红书 Cookie。状态页只检查会话和配置，不会向模型服务商发测试请求。

运行快照包括输入、关键词、搜索结果、证据笔记、卡片、细化方案和修改轨迹，用于后续评测。运行 ID 按用户校验，不能跨用户读取或修改。数据库运行记录默认保留 30 天，启动及每日清理，可通过 `TRIAL_RETENTION_DAYS` 调整。原始小红书缓存仍保存在 `data/captures/cache/`，供所有试用者复用；通过 `XHS_CACHE_TTL_DAYS` 设置命中过期时间（旧文件在下次访问时覆盖）。目前仍共用服务器上的一份小红书 Cookie。数据库和缓存均须在服务器上限制读取权限，且不要作为静态文件提供。

执行 `npm run export:eval` 可将数据库中的运行与阶段快照按 JSONL 输出到标准输出，包含内部用户 ID，不包含应用令牌或小红书 Cookie。导出文件应妥善保管；如需对外共享，先另行去标识化。旧的本地文件快照不会自动迁移到 SQLite，新试用运行才会入库。

项目的正式数据流为前端 → Node HTTP 服务 → 本地 Python 工作进程 → 独立 Playwright 浏览器连接器，不再依赖 `xiaohongshu-mcp`。Python 连接器提供登录状态、笔记搜索和详情；搜索结果含 `id`、`xsecToken` 和来源链接，详情含正文与评论。浏览器会话 Cookie 只保存在本机。

当前每次发现请求固定搜索 **2 个关键词**，不自动补搜。首次查询将原始返回和标准化结果保存到 `data/captures/cache/`；相同关键词再次查询优先读取本地缓存。前端一次运行的关键词计划、逐次搜索结果及去重结果保存在 `data/captures/runs/<runId>/`。目录被 `.gitignore` 排除，包含用户输入、笔记内容与访问令牌，请只在本机查看。缓存命中后不会主动更新；要获取新数据需手动删除对应缓存文件。减少请求次数不能保证账号不受限制。

## 独立连接器

安装 Playwright 后运行：

```powershell
python -m pip install playwright
python xhs_connector.py login
python xhs_connector.py status
python xhs_connector.py search '上海散步'
python scripts/smoke_xhs_connector.py
```

`login` 会打开浏览器供扫码，并将会话保存到 `data/xhs_cookies.json`。Python 调用方式见 [小红书接入验证.md](小红书接入验证.md)。

## Node HTTP 服务

1. 安装 Python 依赖：`python -m pip install -r requirements.txt`，然后用 `python xhs_connector.py login` 登录独立连接器。
2. 在本目录运行 `npm start`，Node 服务默认监听 `http://127.0.0.1:3001`。首次需要真实数据时，它会启动本地 `xhs_worker.py`；可用 `XHS_PYTHON` 指定 Python 可执行文件。
3. 运行 `npm test` 验证字段映射、缓存和 HTTP 接口。测试使用模拟数据，不访问小红书。

可配置环境变量：`XHS_PYTHON`、`HOST`（默认 127.0.0.1）、`PORT`（默认 3001）。

关键词 Agent 已接入 DeepSeek 的 OpenAI 兼容 Chat Completions 接口。复制 `.env.example` 为 `.env`，在本机填写 `DEEPSEEK_API_KEY` 后重启 `npm start`。默认模型名可通过 `MODEL_NAME` 切换；`MODEL_API_URL`、`MODEL_TIMEOUT_MS` 可覆盖接口与超时。也兼容通用的 `MODEL_API_KEY`，以及 `OPENAI_BASE_URL` / `OPENAI_API_KEY`。

`.env` 只由 Node 服务端读取并已加入 `.gitignore`，不会发送给浏览器。未配置密钥时不会调用外部模型，而是继续使用可观察、可测试的本地检索策略，并在返回值中标记 `provider: "fallback"`。可通过 `GET /api/config/model` 查看当前提供方、模型和是否已配置；该接口不会返回密钥。

## 接口

| 方法 | 路径 | 请求 | 返回 `data` |
| --- | --- | --- | --- |
| GET | `/api/data/health` | 无 | 服务状态 |
| GET | `/api/config/model` | 无 | 模型提供方、模型、接口和配置状态（不含密钥） |
| GET | `/api/data/login/status` | 无 | `isLoggedIn`, `username`, `userId` |
| GET | `/api/data/login/qrcode` | 无 | 独立连接器不支持此接口；请运行 `python xhs_connector.py login` |
| POST | `/api/data/notes/search` | `{"keyword":"上海散步","filters":{}}` | `keyword`, `count`, `notes` |
| POST | `/api/data/notes/detail` | `{"id":"笔记ID","xsecToken":"搜索结果中的令牌"}` | 正文、图片、评论等 |
| POST | `/api/discovery/keywords` | `{"location":"上海 · 静安","request":"想安静散步"}` | Agent 运行信息、特征、策略、关键词与 trace |
| POST | `/api/discovery/search` | `{"keywords":["上海 静安","上海 静安 安静散步"]}` | 各关键词搜索状态和去重后的笔记 |
| POST | `/api/discovery/run` | `{"location":"上海 · 静安","request":"想安静散步"}` | 编排运行结果：关键词计划、去重笔记、研究分组、最多三张有来源的玩法卡及 trace |
| POST | `/api/discovery/plan` | `{"runId":"本次运行 ID","cardId":"所选卡片 ID"}` | 只读取本次已保存的正文与评论，为所选方向生成带原文依据的轻行程；不会再次搜索小红书 |
| POST | `/api/discovery/revise` | `{"runId":"当前运行 ID","stage":"cards|detail","cardId":"已选卡片 ID，仅 detail 需要","location":"上海 · 静安","request":"当前完整要求"}` | 在当前节点修改需求；优先复用笔记池，不足时规划补证检索词，保存新版本 |

成功响应为 `{"success":true,"data":...}`；失败响应为 `{"success":false,"error":{"code":"...","message":"..."}}`。真实搜索和详情需要独立连接器的本地登录会话；缓存命中不访问小红书。`xsecToken` 来自搜索结果，可能随时间失效。当前独立连接器只读取页面首次返回的评论，不支持 `loadAllComments` 和 `commentConfig` 选项。

服务端代码也可直接导入 `createXiaohongshuData()`，调用 `loginStatus()`、`loginQrCode()`、`searchNotes(keyword, filters)`、`getNoteDetail(id, xsecToken, options)`。

## Agent 结构

- `src/agents/keyword.js`：Planner。先从用户原话拆分两个检索主题（如简餐与咖啡办公、温泉与咖啡），再让模型分别生成恰好两个搜索词；词序互换、同义改写或两词都堆叠相同活动时会重写一次。重写后仍缺乏区分度则使用分主题的本地兜底词。每次仍只执行两次搜索，检索主题与实际搜索词都保存在运行快照中供后续评测。
- `src/agents/researcher.js`：Researcher。从已读取的正文中选出符合地点和用户要求的方向；不再用规则补满三张卡。没有正文或模型失败时明确返回证据不足。
- `src/agents/curator.js`：Curator。基于研究分组生成最多三张玩法卡，只引用有正文的真实来源，并沿用研究阶段选定的地点和活动。
- `src/agents/discovery-orchestrator.js`：编排层。按 Planner → 搜索 → Researcher → Curator 执行，保存各阶段快照和 trace。
- `src/agents/runtime.js`：通用运行上下文，生成 run ID、时间、状态和可观察 trace。
- `src/discovery.js`：小红书搜索工具层，负责顺序搜索、局部失败容错、去重和来源关键词归因。
- `src/data/local-xiaohongshu.js` 与 `xhs_worker.py`：Node 与独立 Python 连接器的本地数据通路及查询缓存。
- `src/data/run-captures.js`：按 `runId` 保存阶段快照。旧的 `src/data/xiaohongshu.js` 保留用于原 MCP 适配器的离线测试，不再作为默认数据源。

`node scripts/smoke_cached_agents.js` 可以用已保存的两组搜索数据测试研究与卡片生成，不会新增小红书搜索；若模型密钥已配置，会真实调用模型 API。`node scripts/serve_cached_demo.js` 提供同样的缓存数据接口，供前端联调。发现阶段会优先读取部分笔记详情；选中卡片后，细化流程只使用已保存的正文与评论。

### 选中方向后的细化流程

首次发现请求已经挑选最多 6 篇笔记读取正文与可用评论，并按 `runId` 保存证据。用户选中卡片后，前端传 `runId + cardId`；服务端只从该次运行的快照中取出卡片引用的笔记，不触发新的小红书请求。地点卡细化为一个具体落点和行动；连续路线卡细化为最多四个顺序步骤。每一步必须带来源笔记 ID 和正文或评论中的原文片段，服务端校验来源归属及片段是否确实存在。没有正文或没有可核对的步骤时，返回证据不足说明和原笔记链接，不编造时间、距离、价格或现场规则。细化结果按运行和卡片保存在本地，重复点击直接读取。

### 共享需求修改

三张卡展示后出现一个修改表单；选择卡片后仍使用同一表单。前端传当前节点 `stage`，卡片页重做方向，详细页只重做已选方案。表单预填当前地点和**完整要求**，用户可直接改写，避免把“不要喝酒了”与旧的饮酒要求简单拼接。服务端从上轮快照建立笔记池，按笔记 ID 去重并保留正文、评论和命中关键词。Researcher 或 Direction Planner 先用池内证据重算；如果不能形成三个有来源的方向，或详细方案没有通过原文核验的步骤，补证检索规划器最多生成一个新关键词。当前默认只保存计划并在页面标明证据缺口，不向小红书发补充请求；待批量评测数据准备好后再启用补搜。开发验证可设置 `SUPPLEMENTAL_SEARCH_ENABLED=1`，启用后缓存优先搜索且每轮最多一次。模型还能返回尚未被笔记支持的条件。地点变化时建立新运行，不混用旧地点笔记。每轮修改保存父运行 ID、补搜计划、笔记池及新结果；地图和点评类数据源尚未接入。

### 前端缓存试跑

在两个终端分别运行 `node scripts/serve_cached_demo.js` 和 `python -m http.server 8089 --bind 127.0.0.1 --directory web`，然后打开 `http://127.0.0.1:8089/explore.html?cached=1`。页面使用已保存的上海静安笔记，地点需包含“静安”；可修改想法并重复提交，观察方向如何变化。缓存试跑模式只读本地搜索缓存，不会补发小红书请求；模型 API 仍用于研究和卡片生成。普通模式由 `npm start` 提供网页与 API，打开 `http://127.0.0.1:3001/`。
