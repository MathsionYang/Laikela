# 阿里百炼（专属网关）模型接入测试报告

> 测试时间：2026-10-20 15:00 (GMT+8)
> 网关：`https://ws-ppprfnb8819dlxt6.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
> Key 尾号：`…XnaQO5A`（明文不入库、不入文档，仅 `sk-••••` 掩码留存）
> 原始结果：`.probe/bl-test-result.json`（含每次请求体与响应原文）

---

## 一、结论摘要

**12 项测试通过 6 项、失败 6 项。视觉、视频与文本可用，语音（TTS/ASR）不可用。**

| 分组 | 通过/总数 | 结论 |
|---|---|---|
| 视觉（qwen-image） | **3/3** | 全部可用，出图为真实 1024×1024 PNG，可直接接入 |
| 视频（wan3.0-video） | **1/1** | 可用，1080p/30fps 真成片，异步约 3 分钟 |
| 文本（chat） | **2/2** | 全部可用，可作文案主链路 |
| 语音 TTS | **0/3** | 指定型号不存在；清单内替代型号**免费额度已耗尽**（403） |
| 语音 ASR | **0/3** | 指定型号不存在；网关**未开放** ASR 路由（/audio/transcriptions 404，chat 传音频 400） |

用户点名的 6 个模型中，**4 个可用**：

| 用户指定型号 | 实际状态 |
|---|---|
| `qwen-image-2.1-pro` | 可用，16.1s |
| `qwen-image-3.0-pro` | 可用，48.8s（最慢） |
| `qwen-image-2.1-turbo` | 可用，13.2s（不在 /models 清单，但网关支持该别名） |
| `wan3.0-video` | 可用，184s 出 1080p/30fps 5 秒成片（不在 /models 清单，走的是 DashScope 原生异步协议） |
| `sambert-zhida-v1` | **不可用** —— 网关无此模型，TTS 路由未开放 |
| `qwen-audio-3.0-asr-flash-streaming` | **不可用** —— 清单里只有不带 `-streaming` 的型号，且 ASR 路由未开放 |

---

## 二、逐模型明细

### 2.1 鉴权与清单

| 项 | 值 |
|---|---|
| 请求 | `GET /compatible-mode/v1/models` |
| 状态 | **200** |
| 耗时 | 234 ms |
| 结果 | 返回 **178** 个模型 |

### 2.2 视觉模型（全部通过）

统一请求参数：

```json
POST /compatible-mode/v1/images/generations
{
  "model": "<下表>",
  "prompt": "一杯燕麦拿铁放在木桌上，自然光，产品摄影风格，浅景深",
  "size": "1024x1024",
  "n": 1
}
```

| 模型 | HTTP | 耗时 | 响应要点 | 判定 |
|---|---|---|---|---|
| `qwen-image-2.1-pro` | 200 | **16,079 ms** | `data[0].url` 为 OSS 临时地址；`usage={width:1024,height:1024,image_count:1}` | ✅ 通过 |
| `qwen-image-3.0-pro` | 200 | **48,817 ms** | `usage={output_width:1024,output_height:1024,output_image_count:1,input_image_type:"qima_input_1k"}` | ✅ 通过 |
| `qwen-image-2.1-turbo` | 200 | **13,222 ms** | 同 2.1-pro 的 usage 结构 | ✅ 通过（清单外别名） |

**产物校验**：下载 `qwen-image-2.1-pro` 返回的 URL —— HTTP 200、**1,525,932 字节**、`image/png`、PNG magic 正确、实测尺寸 **1024×1024**。是真实图片，不是占位图。

> ⚠️ **两套 usage 结构**：2.x 系列是 `width/height/image_count`，3.0 系列是 `output_width/output_height/output_image_count`。适配层不能只读一套，否则 3.0 的尺寸元信息取不到（图片本身不受影响，尺寸以请求参数为准）。

> ⚠️ **48.8 秒**的 3.0-pro 超过常规 45s 超时。接入时该模型的重试/超时预算需单独放宽到 90s 以上，否则会被误判为超时降级。

### 2.3 语音 TTS（全部失败）

| 尝试 | 端点 | HTTP | 耗时 | 上游返回 | 判定 |
|---|---|---|---|---|---|
| `sambert-zhida-v1` | `/audio/speech` | **404** | 29 ms | 空响应体 | ❌ 路由不存在 |
| `sambert-zhida-v1` | `/chat/completions` + `modalities:[text,audio]` | **400** | 174 ms | `invalid_parameter_error`：`url error, please check url！` | ❌ 网关不识别该模型 |
| `qwen3-tts-flash`（清单内替代） | `/chat/completions` + `modalities:[text,audio]` | **403** | 94 ms | `insufficient_quota`：`Free quota exhausted. To continue accessing the model on a paid basis, please add funds or disable the "use free tier only" mode in the management console.` | ❌ **免费额度耗尽** |

**判定依据**：`sambert-zhida-v1` 不在 178 个模型的清单里，且两条路径分别是「路由 404」和「模型不识别（url error）」，属于**型号不存在**，不是鉴权或额度问题。
`qwen3-tts-flash` 是清单内真实型号，路由正确（否则不会返回业务错误），403 明确指向**额度**。

### 2.4 语音 ASR（全部失败）

| 尝试 | 端点 | HTTP | 耗时 | 上游返回 | 判定 |
|---|---|---|---|---|---|
| `qwen-audio-3.0-asr-flash-streaming` | `/chat/completions` + `input_audio(base64 wav)` | **400** | 112 ms | `invalid_parameter_error`：`url error` | ❌ 型号不存在 |
| `qwen-audio-3.0-asr-flash-streaming` | `/audio/transcriptions`（multipart） | **404** | 28 ms | 空响应体 | ❌ 路由不存在 |
| `qwen-audio-3.0-asr-flash`（清单内替代） | `/chat/completions` + `input_audio` | **400** | 102 ms | `{}`（空错误对象） | ❌ 请求形态不被接受 |

补充探测：`/audio/transcriptions`、`/audio/speech`、`/api/v1/services/audio/tts/generation` 全部 404 或无效，
说明该专属网关**只开放了 chat 与 images 两类兼容路由**，没有音频能力面。

> 测试音频：16 kHz / 16-bit / 单声道 / 1 秒 440 Hz 正弦波，32,044 字节 wav。
> 用它只能验证「链路和参数是否被接受」，无法验证转写准确率 —— 但当前连 200 都没拿到，准确率无从谈起。

### 2.5 视频模型（通过）

`wan3.0-video` 不在 `/models` 清单里，且 **compatible-mode 下的 `/videos`、`/video/generations`、`/contents/generations/tasks` 全部 404**。
真正的入口是 DashScope 原生异步任务 API（`GET /api/v1/tasks` 返回 200 是线索）：

```json
POST https://ws-ppprfnb8819dlxt6.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
Authorization: Bearer sk-ws-…
Content-Type: application/json
X-DashScope-Async: enable          ← 不带这个头会 400

{
  "model": "wan3.0-video",
  "input": { "prompt": "一杯燕麦拿铁放在木桌上，镜头缓慢推进，自然光，产品广告质感" },
  "parameters": { "size": "1280*720", "duration": 5, "prompt_extend": true }
}
```

| 阶段 | 结果 |
|---|---|
| 提交任务 | **HTTP 200**，**203 ms**，返回 `task_id=0fefbfa8-68e7-4ba0-942c-407190ce85fd`，`task_status=PENDING` |
| 轮询 `GET /api/v1/tasks/{task_id}` | `PENDING → RUNNING → SUCCEEDED`，**总耗时 184 秒**（约 3 分钟） |
| 产物 | `video_url` → HTTP 200，**9,261,923 字节（8.83 MB）**，`video/mp4`，容器标识 `ftypisom` 正确 |
| 返回 usage | `{video_count:1, duration:5.0, SR:1080, output_video_duration:5.0, fps:30, ratio:"16:9"}` |

**判定：✅ 通过。** 视频可播放、体积与时长合理，不是占位文件。

> ⚠️ **请求 720p 返回 1080p**：请求参数是 `size=1280*720`，但 `usage.SR=1080`，成片实际按 1080p 产出。
> 计费与码率要按 1080p 估，不能按请求参数估。
>
> ⚠️ **3 分钟不是超时**：现有视频分支的等待预算是 6 分钟，够用；但若同一队列并发多单，
> 要按「单条 3 分钟」重新核算 worker 并发，否则队列会堆。

### 2.6 文本模型（全部通过）

| 模型 | HTTP | 耗时 | 响应 | 判定 |
|---|---|---|---|---|
| `qwen3.8-flash` | 200 | 729 ms | `content="收到"`，`finish_reason=stop`，usage 21 completion tokens（其中推理 17） | ✅ 通过 |
| `deepseek-v4.1-flash` | 200 | 841 ms | `content=""`，`finish_reason=length`，20 个 completion token **全部被 reasoning 占用** | ⚠️ 连通但输出被截断 |

> ⚠️ **推理模型陷阱**：`deepseek-v4.1-flash` 在 `max_tokens=20` 时正文为空、`finish_reason=length`。
> 这不是故障，是推理 token 先吃满了预算。项目里已按 `TRUNCATED` 单独报错并提示调大 `max_tokens`，
> 正文类任务建议 **≥ 1500**。

---

## 三、异常归因

| 现象 | 真实原因 | 处置 |
|---|---|---|
| `sambert-zhida-v1` → 404 + 400 url error | 该网关**无 Sambert 系列**，且不提供 `/audio/speech` | 换 TTS 方案：① 用清单内 `qwen3-tts-flash` 并充值；② 继续用本地音轨合成 |
| `qwen3-tts-flash` → 403 insufficient_quota | 工作空间处于「仅用免费额度」模式且额度已耗尽 | 控制台充值或关闭 “use free tier only”，充值后同一请求即可用 |
| `qwen-audio-3.0-asr-flash-streaming` → 400 | 清单里没有 `-streaming` 后缀型号 | 若必须流式 ASR，需走 DashScope 原生 WebSocket 协议（该网关未开放），或换 `qwen3-asr-flash-realtime` |
| `qwen-audio-3.0-asr-flash` → 400 `{}` | 网关未实现 audio 输入的消息形态 | 同上，ASR 暂不接入 |
| `/audio/transcriptions`、`/audio/speech` → 404 | 网关只代理 chat / images | 不在这两个端点上浪费时间 |

---

## 四、接入建议

| 能力 | 结论 | 落地方式 |
|---|---|---|
| 文生图 | **可以接** | 走 `POST {base}/images/generations`，与现有 `ark-image` 协议完全一致，可直接复用适配器 |
| 文生视频 | **可以接** | 走 DashScope 原生异步：`/api/v1/services/aigc/video-generation/video-synthesis` + `X-DashScope-Async: enable`，轮询 `/api/v1/tasks/{id}`；与豆包 `/contents/generations/tasks` 是两套协议，适配层已按 `protocol` 分流 |
| 文案生成 | **可以接** | 走 `POST {base}/chat/completions`，OpenAI 协议 |
| 语音合成 | **暂不接** | 唯一可用型号额度已耗尽，接了就是一个必然失败的选项；充值时再开 |
| 语音识别 | **不接** | 网关无此能力面 |

**默认模型选型**（按实测性价比）：

- 出图：`qwen-image-2.1-turbo`（13.2s）→ `qwen-image-2.1-pro`（16.1s）→ `qwen-image-3.0-pro`（48.8s，仅高质量场景）
- 视频：`wan3.0-video`（1080p，约 3 分钟/条，按秒计费，单条成本高）
- 文案：`qwen3.8-flash`（729ms，正文正常）优先；`deepseek-v4.1-flash` 仅用于需要推理的任务且 `max_tokens ≥ 1500`

**必须处理的四个协议差异**：

1. `usage` 两套字段（2.x / 3.0 系列），读尺寸要兼容。
2. 3.0-pro 耗时近 50s，超时预算要单独放宽。
3. 推理模型正文可能为空（`finish_reason=length`），需区分「截断」与「故障」。
4. 视频走**根路径** `/api/v1/...`，而文本/图像走 `/compatible-mode/v1`，两者不能拼在同一个 baseUrl 上（适配层用 `dashscopeHost()` 剥 host）。

---

## 五、项目内集成验证（接进目录之后再测一遍）

模型能调通 ≠ 系统能跑通。接入 `catalog.ts` / `router.ts` / `pipeline.ts` 之后，用真实任务又跑了一遍：

| 场景 | 工具 | 结果 |
|---|---|---|
| 出图 | `image-gen`（1 张） | **22.2s 成功**，扣 **16 积分**，产出 `Qwen-Image 2.1 Turbo-1.png` **1,993 KB**，PNG magic 正确 |
| 出片 | `video-movie`（15 秒） | **230s 成功**，扣 **780 积分**，产出 `成片.mp4` **18.45 MB**，`ftypisom` 正确，`degraded=无` |

两次任务的 `provider` 均为「阿里百炼」，`output.model.key` 分别为 `bailian-image-turbo` / `bailian-video`，
说明**确实走了百炼，不是静默降级到本地**。

> 视频这一单：本地分镜先出（几秒），云端成片再补 3 分半 —— 中途任务状态一直是 `running · 云端成片渲染中`，
> 这是设计如此（分镜先可看，成片后到），不是卡住。

---

## 六、复现方式

```bash
# 1. 把 Key 写进 .env（BAILIAN_API_KEY）
# 2. 跑完整测试，结果落 .probe/bl-test-result.json
BL_KEY=sk-ws-... node .probe/bl-test.mjs
```

测试脚本已固化为 `.probe/bl-test.mjs`，可随时回归；报告中的耗时均为单次实测，非平均值。
