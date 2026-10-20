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
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    },
    doubao: {
      apiKey: process.env.DOUBAO_API_KEY ?? "",
      baseUrl: process.env.DOUBAO_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
      model: process.env.DOUBAO_MODEL ?? "doubao-pro-32k",
    },
    image: {
      apiKey: process.env.IMAGE_API_KEY ?? "",
      baseUrl: process.env.IMAGE_API_BASE ?? "",
      model: process.env.IMAGE_MODEL ?? "image-1",
    },
  },

  /** 无任何供应商密钥时，全部走本地确定性 Provider，界面会显式标注 */
  get hasCloudProvider() {
    return Boolean(
      this.providers.deepseek.apiKey ||
        this.providers.doubao.apiKey ||
        this.providers.image.apiKey,
    );
  },
};

export const DEMO_ORG_ID = "org_laikela_demo";
export const DEMO_USER_ID = "usr_laikela_owner";
