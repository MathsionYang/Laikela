/**
 * 运行时配置。所有外部依赖都通过环境变量注入，
 * 未配置供应商密钥时自动降级为本地 Provider（见 lib/gateway/policy.ts）。
 */

const num = (v: string | undefined, fallback: number) =>
  v === undefined || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v);

export const env = {
  appName: "来客啦",
  appSub: "AI 内容营销专家",

  /** auto：先探 PostgreSQL，连不上自动降级到 PGlite（嵌入式 Postgres/WASM） */
  dbDriver: (process.env.DB_DRIVER ?? "auto") as "auto" | "postgres" | "pglite",
  pgliteDir: process.env.PGLITE_DIR ?? "./data/pglite",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://laikela:laikela@127.0.0.1:5432/laikela",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",

  /** 媒体与导出文件的签名密钥，生产必须覆盖 */
  signingSecret: process.env.SIGNING_SECRET ?? "laikela-dev-signing-secret",
  /** 签名 URL 有效期（秒） */
  signedUrlTtl: num(process.env.SIGNED_URL_TTL, 60 * 60 * 6),

  /**
   * 用户自带 API Key（BYOK）落库前的加密主密钥。
   * 未单独配置时退化用 signingSecret 派生，保证开箱可跑；
   * 生产环境务必单独配置并纳入密钥管理（轮换时需重加密历史凭证）。
   */
  credentialSecret: process.env.CREDENTIAL_SECRET ?? "",

  /**
   * 发信。未配 SMTP_HOST 时走 outbox 驱动：邮件正文落 mail_outbox 表并打到控制台，
   * 本机不需要真实邮箱也能把「注册 → 收码 → 验证」跑通。
   */
  mail: {
    driver: (process.env.MAIL_DRIVER ?? (process.env.SMTP_HOST ? "smtp" : "outbox")) as
      | "smtp"
      | "outbox",
    from: process.env.MAIL_FROM ?? "来客啦 <no-reply@laikela.local>",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      /** 465 走 implicit TLS，587 走 STARTTLS */
      port: num(process.env.SMTP_PORT, 465),
      secure: process.env.SMTP_SECURE !== "0",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  },

  /** 注册邮箱验证。REQUIRE_EMAIL_VERIFY=0 可整体关掉（内部部署/自用机） */
  verify: {
    required: process.env.REQUIRE_EMAIL_VERIFY !== "0",
    ttlMinutes: num(process.env.VERIFY_TTL_MINUTES, 15),
    maxAttempts: num(process.env.VERIFY_MAX_ATTEMPTS, 5),
    resendCooldownSec: num(process.env.VERIFY_RESEND_COOLDOWN, 60),
    /** 每小时同一邮箱最多发几次，防止被当短信炮台 */
    hourlyCap: num(process.env.VERIFY_HOURLY_CAP, 6),
  },

  /**
   * 人工转账的收款信息。个人主体拿不到收款 API 时的过渡形态
   * （见 docs/PAYMENT-ACCESS.md）：页面展示这些信息，用户转完提交单号，管理员后台核对。
   * 留空时页面显示「联系管理员获取」。
   */
  payment: {
    /**
     * 是否允许「mock 支付通道」（下单即置为已支付）。
     *
     * 默认**关闭**：线上绝不能出现「点一下套餐就到账」的假支付。
     * 本机演示/自动化测试要跑通订阅流程时显式设 PAYMENT_MOCK=1。
     * 关闭时开通套餐走「人工转账 → 管理员审核」（见 docs/PAYMENT-ACCESS.md）。
     */
    mock: process.env.PAYMENT_MOCK === "1",
    payee: process.env.PAY_PAYEE ?? "",
    wechat: process.env.PAY_WECHAT ?? "",
    alipay: process.env.PAY_ALIPAY ?? "",
    bank: process.env.PAY_BANK ?? "",
    contact: process.env.PAY_CONTACT ?? "",
    note: process.env.PAY_NOTE ?? "转账时请备注你的注册邮箱，方便对账；到账后管理员在后台确认并发放额度。",
  },

  storage: {
    // 默认用本地目录（零额外依赖）；需要 S3 形态时改成 s3 并启动 MinIO
    driver: (process.env.STORAGE_DRIVER ?? "local") as "s3" | "local",
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? "./data/storage",
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "laikela",
    accessKey: process.env.S3_ACCESS_KEY ?? "laikela",
    secretKey: process.env.S3_SECRET_KEY ?? "laikela123",
    forcePathStyle: true,
  },

  queue: {
    /** auto：先探 Redis，连不上自动降级为进程内队列 */
    driver: (process.env.QUEUE_DRIVER ?? "auto") as "auto" | "redis" | "memory",
    // BullMQ 不允许队列名包含冒号
    name: "laikela-jobs",
    concurrency: num(process.env.WORKER_CONCURRENCY, 2),
  },

  providers: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      /**
       * 默认值跟账号实际可用模型对齐（GET /models 实测）。
       * 曾经默认写 deepseek-chat，而目录里跑的却是 deepseek-flash ——
       * 名字对不上就会 400 model_not_found，且报错长得像「Key 坏了」。
       */
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
    },
    doubao: {
      apiKey: process.env.DOUBAO_API_KEY ?? "",
      baseUrl: process.env.DOUBAO_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
      model: process.env.DOUBAO_MODEL ?? "doubao-pro-32k",
    },
    /**
     * 阿里百炼（专属网关走 compatible-mode）。
     *
     * 能力面经实测（docs/ALIYUN-BAILIAN-TEST.md）：
     *   文本 ✅ / 出图 ✅ / 语音 ❌（网关未开放 /audio/*，TTS 型号额度用尽）
     * 所以这里只配文本与出图两个模型，语音仍走本地音轨合成。
     */
    bailian: {
      apiKey: process.env.BAILIAN_API_KEY ?? "",
      baseUrl:
        process.env.BAILIAN_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      textModel: process.env.BAILIAN_TEXT_MODEL ?? "qwen3.8-flash",
      imageModel: process.env.BAILIAN_IMAGE_MODEL ?? "qwen-image-2.1-turbo",
    },
    image: {
      apiKey: process.env.IMAGE_API_KEY ?? "",
      baseUrl: process.env.IMAGE_API_BASE ?? "",
      model: process.env.IMAGE_MODEL ?? "image-1",
    },
  },

  ai: {
    /**
     * 单次调用允许生成的最大 token 数。
     *
     * 原来的 2200 是凭空拍的：表格类工具（一键追爆 10 条、视频反推分镜表）
     * 实测要 3000–5000 token，写到这里就断在半句，JSON 没闭合，
     * 上层把「被截断」误报成「返回内容不是预期的 JSON 结构（BAD_JSON）」。
     * DeepSeek V4.1 Flash 单次上限 39 万 token，8192 足够；
     * 用不完不产生费用（按实际生成量计费）。
     */
    maxOutputTokens: Math.max(1024, num(process.env.AI_MAX_OUTPUT_TOKENS, 8192)),
  },

  /** 无任何供应商密钥时，全部走本地确定性 Provider，界面会显式标注 */
  get hasCloudProvider() {
    return Boolean(
      this.providers.deepseek.apiKey ||
        this.providers.doubao.apiKey ||
        this.providers.bailian.apiKey ||
        this.providers.image.apiKey,
    );
  },
};

export const DEMO_ORG_ID = "org_laikela_demo";
export const DEMO_USER_ID = "usr_laikela_owner";
