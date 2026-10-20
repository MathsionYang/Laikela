# 来客啦 · AI 内容营销专家

面向中小商家的一站式 AI 内容生产台：15 个能力（文案 / 海报 / 封面 / 分镜 / 数字人 / 语音 / 选题 / 复盘），
一条任务链路打通「输入 → 生成 → 审核 → 素材归档 → 用量与积分结算」。

技术栈对齐 `神秘力量_AI内容营销专家_功能复刻分析.md`，UI 视觉基准为 `../prototype-v2.html`。

---

## 一、快速启动

```bash
# 1) 基础设施（PostgreSQL 16 + Redis 7）
docker compose up -d

# 2) 依赖
npm install

# 3) 环境变量（复制后按需修改）
cp .env.example .env

# 4) 开发：Web + Worker 一起起
npm run dev:all
# 或者分开：npm run dev（Web） / npm run worker（队列消费者）

# 5) 生产
npm run build && npm start
```

打开 http://localhost:3000 ，用演示账号登录：

| 账号 | 口令 | 角色 |
| --- | --- | --- |
| `owner@laikela.local` | `laikela2026` | owner（空间管理员） |

> 没启动 Docker 也能跑：`DB_DRIVER=auto` 会先探 PostgreSQL，连不上自动降级到 PGlite（嵌入式 Postgres/WASM）；
> `QUEUE_DRIVER=auto` 同理，Redis 不可用时用进程内队列。功能一致，只是不适合多实例。

---

## 二、模型配置：三条路径，按需选一条

这是本项目最需要说清楚的部分。模型配置分三层，**越靠下越即时生效**：

| 层级 | 配置位置 | 谁付费 | 生效方式 | 适用场景 |
| --- | --- | --- | --- | --- |
| ① 平台托管 Key | `.env` 的 `DEEPSEEK_API_KEY` / `DOUBAO_API_KEY` | 平台 | 重启进程 | 你自己运营，所有租户共用 |
| ② 租户 BYOK | 登录后 `/settings/models` → 供应商凭证 | 用户 | 即时 | 让客户带自己的厂商 Key |
| ③ 自定义端点 | `/settings/models` → 接入任意兼容模型 | 用户 | 即时 | 自建 vLLM/Ollama、中转站、Azure、月之暗面… |

### ① 平台托管 Key（后台怎么配内置模型的 Key）

改 `.env`：

```ini
# DeepSeek：文本主力
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# 豆包 · 火山方舟：同时驱动文本 / Image 2.5 / Seedance 2.5 / 语音
DOUBAO_API_KEY=xxxxxxxx-xxxx-xxxx
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_MODEL=doubao-pro-32k
```

- 改完**必须重启**进程（`npm start` / `npm run dev`），因为 Key 在模块加载时读入。
- 一个 Key 覆盖该厂商**全部**模型：豆包那把 Key 同时给 `doubao-pro-32k`、`doubao-image-2.5`、`doubao-seedance-2.5`、`doubao-tts` 用。
- 不配也能跑：路由自动落到本地引擎（规则文案 / 字体排版 / 分镜渲染 / 音轨合成），产出结构完全一致。
- 密钥安全：`CREDENTIAL_SECRET` 是加密 BYOK 与端点 Key 的主密钥，不配则用 `SIGNING_SECRET` 派生；
  一旦库里有历史凭证就不要再换，否则旧密文解不开。

### ② 租户 BYOK（同一厂商换自己的钥匙）

`/settings/models` → 「供应商凭证」→ 粘贴 Key → 保存。

- 只存密文：AES-256-GCM，前端永远只看到 `sk-••••7890` 这样的掩码。
- 优先级：**BYOK > 平台 Key**。填了就走你的额度。
- 解密失败**不静默回落**到平台 Key —— 否则用户会以为在用自己的 Key 却被平台计费。
- 一次调用失败只标记 `last_error`，不会停用；下次成功自动清除。
- 计费：自带 Key 每次任务只扣 1 点平台服务费（模型成本由用户直接付给厂商）。

### ③ 自定义端点（任意 OpenAI 协议兼容服务）

`/settings/models` → 「接入任意兼容模型」，填三个值即可：

```
Base URL   https://api.siliconflow.cn/v1      # 一般以 /v1 结尾，末尾不要写 /chat/completions
模型名称   Qwen/Qwen2.5-72B-Instruct          # 服务端真实 model id，不是展示名
API Key    sk-xxxxxx
```

- 判据只有一条：服务实现 `POST {base_url}/chat/completions` 且用 `Authorization: Bearer`。
  OpenAI、DeepSeek、硅基流动、月之暗面、通义、vLLM、Ollama、one-api/new-api 中转站全部适用。
- 出图类服务选「图像」类型，按 `POST {base_url}/images/generations` 调用。
- 「测试连接」会真的发一次最小请求（`max_tokens=16`），并对 404 / 401 / model 不存在分别给排查提示 ——
  兼容层的坑基本就在「baseUrl 要不要带 /v1」和「模型名对不对」这两处。
- 保存后立刻出现在生成页的「生成模型」下拉里，和内置模型共用同一套路由、计费、降级逻辑。

### 模型目录与权限

模型清单在 `src/lib/ai/catalog.ts`（代码即真相，跟着版本走），运行时开关在 `model_catalog` 表：

| 概念 | 说明 |
| --- | --- |
| `requiresPlan` | 该模型要求的最低套餐（free < creator < studio < enterprise） |
| `byokOnly` | 平台不代付，必须自带 Key（如 Seedance 2.5，按秒计费防误烧） |
| `fallback` | 平台不可用时的降级目标 |
| `credits` | 平台代付时该模型的积分（可在库里覆盖） |

路由顺序：**显式偏好 → 能力匹配 → 目录优先级 → 降级链 → 本地兜底**。本地模型永远最后，保证任何配置问题都不会让任务跑不出来。

---

## 三、账号 · 订阅 · 积分

| 模块 | 实现要点 | 位置 |
| --- | --- | --- |
| 登录 | scrypt 加盐摘要；会话 token 只存 `sha256(token)`；cookie `httpOnly` | `src/lib/auth.ts` |
| 订阅 | `plans × subscriptions × orders`，部分唯一索引保证单 active | `src/lib/billing.ts` |
| 积分 | 账本式：余额 = `sum(delta)`，不存冗余余额；`pg_advisory_xact_lock` 串行化同租户并发 | `src/lib/credits.ts` |
| 幂等 | `job:<id>:consume` / `job:<id>:refund` / `grant:<org>:<月份>` 唯一索引 | 同上 |
| 退款 | 任务失败或取消自动退回；无扣减的任务退款不产生流水 | `src/lib/jobs/pipeline.ts` |

计费口径：

```
平台代付        → 按工具基准价扣积分（模型成本已含在工具价里）
自带 Key / 自定义端点 → 每次 1 点平台服务费
本地模型        → 按工具基准价扣（无外部成本，但有算力占用）
失败 / 取消     → 全额退回（幂等，不会重复退）
```

---

## 四、目录速览

```
src/
├── app/
│   ├── (console)/            控制台（总览/工具/素材库/增长/订阅/模型接入/管理台）
│   ├── login/                登录与注册
│   └── api/                  REST + SSE
├── lib/
│   ├── ai/                   ★ 模型网关
│   │   ├── catalog.ts        内置模型目录（代码即真相）
│   │   ├── credentials.ts    AES-256-GCM 凭证加解密、BYOK 解析
│   │   ├── custom.ts         自定义 OpenAI 兼容端点
│   │   ├── adapters.ts       协议适配：chat / images / video task / TTS
│   │   └── router.ts         选型、权限、计费、降级
│   ├── gateway/              文案生成的编排与 JSON 校验、重试、本地兜底
│   ├── jobs/                 任务状态机、队列、流水线
│   ├── db/                   双驱动（postgres / pglite）+ schema + seed
│   └── media/                海报 / 封面 / 分镜 / 音频合成（sharp + SVG）
└── components/               Shell、工作台、结果渲染
```

---

## 五、主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` `/api/auth/register` `/api/auth/logout` | 认证 |
| GET | `/api/tools` | 工具目录 + 运行统计 |
| POST | `/api/jobs` | 创建任务（`{tool, input, modelKey?}`，返回选定模型与扣费） |
| GET | `/api/jobs/[id]` · `/events` | 任务详情 / SSE 进度 |
| POST | `/api/jobs/[id]/cancel` | 取消并退款 |
| GET | `/api/models` | 模型目录 + 可用性 + Key 来源 + 已接端点 |
| PATCH | `/api/models` | 运行时启停某个模型 |
| GET/POST/DELETE | `/api/models/keys` | BYOK 读写删 |
| GET/POST/PATCH/DELETE | `/api/models/endpoints` | 自定义端点管理 |
| POST | `/api/models/endpoints/test` | 真打一次最小请求验证连通性 |
| GET | `/api/billing` · POST · PATCH | 订阅概览 / 开通 / 取消恢复 |
| GET | `/api/assets` · `/api/dashboard` · `/api/usage` | 素材 / 总览 / 用量 |

---

## 六、已知边界

- 视频任务输出「分镜关键帧 + 时间轴 + 云端成片（若 Seedance 可用）」；本机无 FFmpeg，不做本地 mp4 编码。
- 支付为演示通道（`channel=mock`，下单即 paid）；接微信支付/支付宝时改由回调驱动订单状态。
- 自定义端点目前支持 `text` 与 `image` 两类协议；`video` / `audio` 需厂商专有协议，走内置目录。
- 本机 `next start` 走 http 时，`COOKIE_SECURE` 不要设 1，否则 cookie 不会被回传，表现为「登录成功却立刻掉线」。
