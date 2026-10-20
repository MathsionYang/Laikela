-- ============================================================
-- 来客啦 · AI 内容营销专家 — PostgreSQL schema
-- 对应文档 5.2 核心表；每张业务表都带 organization_id（租户隔离）
-- 所有语句幂等，可在启动时重复执行
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  plan          text NOT NULL DEFAULT 'free',
  quota_month   integer NOT NULL DEFAULT 2000,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'owner',
  avatar_hue    integer NOT NULL DEFAULT 38,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS projects (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 工具目录：与代码里的 tools.ts 同步，便于管理台开关与排序
CREATE TABLE IF NOT EXISTS tool_definitions (
  slug          text PRIMARY KEY,
  section       text NOT NULL,
  name          text NOT NULL,
  tagline       text NOT NULL DEFAULT '',
  kind          text NOT NULL,
  eta_seconds   integer NOT NULL DEFAULT 30,
  credit_cost   integer NOT NULL DEFAULT 1,
  badge         text,
  enabled       boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 版本化提示词：任务会记录 prompt_version，保证结果可追溯
CREATE TABLE IF NOT EXISTS prompt_versions (
  id            text PRIMARY KEY,
  tool_slug     text NOT NULL,
  version       text NOT NULL,
  body          text NOT NULL,
  json_schema   jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_slug, version)
);

-- 模板 DSL：海报 / 封面 / 视频 / 数字人共用
CREATE TABLE IF NOT EXISTS templates (
  id            text PRIMARY KEY,
  kind          text NOT NULL,
  name          text NOT NULL,
  version       text NOT NULL DEFAULT 'v1',
  spec          jsonb NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 任务：状态机 queued → running → post_processing → reviewing → succeeded/failed/canceled
CREATE TABLE IF NOT EXISTS jobs (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool_slug     text NOT NULL,
  status        text NOT NULL DEFAULT 'queued',
  stage         text NOT NULL DEFAULT '排队中',
  progress      integer NOT NULL DEFAULT 0,
  input         jsonb NOT NULL DEFAULT '{}'::jsonb,
  output        jsonb,
  model_provider text,
  model_name    text,
  prompt_version text,
  parent_job_id text,
  attempts      integer NOT NULL DEFAULT 0,
  error_code    text,
  error_message text,
  cost_cny      numeric(12, 4) NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_jobs_org_created ON jobs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_tool ON jobs(tool_slug);

CREATE TABLE IF NOT EXISTS job_attempts (
  id            text PRIMARY KEY,
  job_id        text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt       integer NOT NULL DEFAULT 1,
  provider      text,
  model         text,
  status        text NOT NULL DEFAULT 'running',
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_attempts_job ON job_attempts(job_id);

-- 素材：role 区分 original / proxy / thumbnail / final / subtitle / metadata
CREATE TABLE IF NOT EXISTS assets (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        text REFERENCES jobs(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  role          text NOT NULL DEFAULT 'final',
  name          text NOT NULL,
  mime          text NOT NULL,
  bytes         integer NOT NULL DEFAULT 0,
  width         integer,
  height        integer,
  duration_ms   integer,
  storage_key   text NOT NULL,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_org_created ON assets(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_job ON assets(job_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(org_id, kind, role);

CREATE TABLE IF NOT EXISTS asset_versions (
  id            text PRIMARY KEY,
  asset_id      text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version       integer NOT NULL DEFAULT 1,
  storage_key   text NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 文案文档：Tiptap 保存的 HTML + 结构化原始输出
CREATE TABLE IF NOT EXISTS copy_documents (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        text REFERENCES jobs(id) ON DELETE SET NULL,
  tool_slug     text NOT NULL,
  title         text NOT NULL,
  structured    jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_html  text NOT NULL DEFAULT '',
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_copy_org ON copy_documents(org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS voices (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  gender        text,
  timbre        text,
  lang          text DEFAULT 'zh-CN',
  provider      text NOT NULL DEFAULT 'local',
  consent_ref   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personas (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  positioning   text,
  traits        jsonb NOT NULL DEFAULT '[]'::jsonb,
  catchphrase   text,
  boundaries    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trend_events (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform      text NOT NULL,
  keyword       text NOT NULL,
  heat          numeric(12, 1) NOT NULL DEFAULT 0,
  growth        numeric(8, 1) NOT NULL DEFAULT 0,
  confidence    numeric(4, 2) NOT NULL DEFAULT 0.8,
  source        text NOT NULL DEFAULT 'sample',
  captured_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trends_org ON trend_events(org_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS competitors (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform      text NOT NULL,
  account       text NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_metrics (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        text REFERENCES jobs(id) ON DELETE SET NULL,
  platform      text NOT NULL,
  views         integer NOT NULL DEFAULT 0,
  likes         integer NOT NULL DEFAULT 0,
  comments      integer NOT NULL DEFAULT 0,
  shares        integer NOT NULL DEFAULT 0,
  saves         integer NOT NULL DEFAULT 0,
  captured_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metrics_org ON content_metrics(org_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS usage_records (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        text REFERENCES jobs(id) ON DELETE SET NULL,
  provider      text NOT NULL,
  model         text,
  unit          text NOT NULL,
  quantity      numeric(12, 3) NOT NULL DEFAULT 0,
  unit_price    numeric(12, 6) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'CNY',
  cost_cny      numeric(12, 4) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_org ON usage_records(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_records (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        text REFERENCES jobs(id) ON DELETE SET NULL,
  target        text NOT NULL DEFAULT 'output',
  level         text NOT NULL DEFAULT 'pass',
  hits          jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestion    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor         text NOT NULL DEFAULT 'system',
  action        text NOT NULL,
  target        text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id, created_at DESC);

-- 系统设置：管理台的模型开关、Provider 状态等
CREATE TABLE IF NOT EXISTS app_settings (
  key           text PRIMARY KEY,
  value         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- ============================================================
-- 账号 · 订阅 · 积分
-- ============================================================

-- 登录凭证：只存 scrypt 摘要，不存明文
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- 会话：cookie 里只放随机 token，库里存 sha256(token)，泄露数据库也无法复用会话
CREATE TABLE IF NOT EXISTS sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  user_agent    text,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 套餐：免费版 / 创作版 / 工作室 / 企业版
CREATE TABLE IF NOT EXISTS plans (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  tagline         text NOT NULL DEFAULT '',
  price_cny       numeric(10,2) NOT NULL DEFAULT 0,
  monthly_credits integer NOT NULL DEFAULT 0,
  seats           integer NOT NULL DEFAULT 1,
  features        jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort            integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true
);

-- 订阅：同一组织同时只有一条 active（部分唯一索引保证）
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code           text NOT NULL REFERENCES plans(code),
  status              text NOT NULL DEFAULT 'active',
  seats               integer NOT NULL DEFAULT 1,
  price_cny           numeric(10,2) NOT NULL DEFAULT 0,
  period_start        timestamptz NOT NULL DEFAULT now(),
  period_end          timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  auto_renew          boolean NOT NULL DEFAULT true,
  order_no            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_org ON subscriptions(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_active ON subscriptions(org_id) WHERE status = 'active';

-- 积分流水：余额 = sum(delta)，只增不改，任何时刻都能审计出余额怎么来的
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id          text REFERENCES jobs(id) ON DELETE SET NULL,
  kind            text NOT NULL,               -- grant | consume | refund | expire | adjust
  delta           integer NOT NULL,            -- 正数入账，负数出账
  balance_after   integer NOT NULL,
  reason          text NOT NULL DEFAULT '',
  idempotency_key text UNIQUE,                 -- 幂等键，防重复扣/重复补
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credits_org ON credit_ledger(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credits_job ON credit_ledger(job_id);

-- 支付订单（演示环境直接置 paid；接微信支付/支付宝时改由回调驱动）
CREATE TABLE IF NOT EXISTS orders (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code     text NOT NULL REFERENCES plans(code),
  amount_cny    numeric(10,2) NOT NULL DEFAULT 0,
  months        integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'pending', -- pending | paid | failed | refunded
  channel       text NOT NULL DEFAULT 'mock',    -- mock | wechat | alipay
  out_trade_no  text,
  paid_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_org ON orders(org_id, created_at DESC);

-- ============================================================
-- 多模型接入
-- ============================================================

-- 模型目录的「运行时开关」：清单与单价以代码为准（src/lib/ai/catalog.ts），
-- 这张表只存运维可调的覆盖项（关停某个模型、临时调价、排序），启动时同步。
CREATE TABLE IF NOT EXISTS model_catalog (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT true,
  priority    integer NOT NULL DEFAULT 0,
  credits     integer,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 用户自带的供应商凭证（BYOK）。明文永不落库：
-- secret_cipher 为 AES-256-GCM 密文（v1:iv:tag:data），key_hint 仅供前端显示掩码。
CREATE TABLE IF NOT EXISTS provider_credentials (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider      text NOT NULL,                 -- deepseek | doubao
  label         text NOT NULL DEFAULT '',
  secret_cipher text NOT NULL,
  key_hint      text NOT NULL,
  status        text NOT NULL DEFAULT 'active', -- active | error | disabled
  created_by    text,
  last_used_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

-- 任务实际使用的模型（创建时由路由决定，执行时以它为首选）
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS model_key text;
CREATE INDEX IF NOT EXISTS idx_jobs_model ON jobs(model_key);

-- 自定义端点：任何「OpenAI 协议兼容」的服务，用户自己填 URL + 模型名 + Key
-- 与 provider_credentials 的区别：后者是「同一厂商换一把钥匙」，
-- 这张表是「新接一个厂商/自建网关/中转站」，base_url 与 model 都是自定义的。
CREATE TABLE IF NOT EXISTS model_endpoints (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,                       -- 展示名
  kind            text NOT NULL DEFAULT 'text',        -- text | image
  protocol        text NOT NULL DEFAULT 'openai-chat', -- openai-chat | openai-image
  base_url        text NOT NULL,
  model_name      text NOT NULL,
  context_k       integer,
  credits         integer NOT NULL DEFAULT 1,
  secret_cipher   text NOT NULL,
  key_hint        text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  created_by      text,
  last_used_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_endpoints_org ON model_endpoints(org_id, created_at DESC);

-- ============================================================
-- 邮箱验证（注册闭环）
--   1. users.email_verified_at 为 null = 未验证；存量账号由代码侧一次性回填
--   2. 验证码只存 HMAC 摘要，明文只在发信那一刻存在内存里
--   3. 冷却与失败次数都落在行上，不依赖 Redis，单机/多实例都成立
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS email_verifications (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  purpose      text NOT NULL DEFAULT 'register',   -- register | reset（复位留位）
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verif_user ON email_verifications(user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verif_email ON email_verifications(email, created_at DESC);

-- 发信留痕：outbox 驱动（未配 SMTP）时正文与验证码落这里，方便本机调试与事后追查
CREATE TABLE IF NOT EXISTS mail_outbox (
  id           text PRIMARY KEY,
  to_addr      text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  driver       text NOT NULL DEFAULT 'outbox',     -- smtp | outbox
  message_id   text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON mail_outbox(created_at DESC);

-- ============================================================
-- 平台管理员 + 人工转账充值
--   is_admin 与租户内的 role（owner/admin/member）是两套东西：
--   前者跨租户，能看所有用户、调额度和套餐、审转账；后者只管自己那一间工作空间。
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin) WHERE is_admin = true;

-- 人工转账认领单：用户线下转账后提交凭证，管理员核对通过才发额度
CREATE TABLE IF NOT EXISTS manual_payments (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code      text,                                  -- null = 只充值积分，不动套餐
  months         integer NOT NULL DEFAULT 1,
  amount_cny     numeric(10,2) NOT NULL,
  channel        text NOT NULL DEFAULT 'wechat',        -- wechat | alipay | bank
  payer_name     text,                                  -- 付款人（可能与注册名不同）
  transfer_no    text,                                  -- 转账单号 / 交易流水号
  note           text,
  proof_url      text,                                  -- 付款截图（本地存储的签名 URL）
  status         text NOT NULL DEFAULT 'pending',       -- pending | approved | rejected | canceled
  credits_granted integer NOT NULL DEFAULT 0,
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_pay_org ON manual_payments(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_pay_status ON manual_payments(status, created_at DESC);

-- 管理员操作审计：改额度、改套餐、审单，全部留痕（谁、对谁、改了什么、为什么）
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           text PRIMARY KEY,
  actor_id     text NOT NULL,
  actor_email  text NOT NULL DEFAULT '',
  action       text NOT NULL,                           -- credits.adjust | plan.change | payment.approve | payment.reject
  target_type  text NOT NULL DEFAULT 'org',             -- org | user | payment
  target_id    text NOT NULL DEFAULT '',
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
