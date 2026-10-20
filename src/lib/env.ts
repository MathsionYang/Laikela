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
