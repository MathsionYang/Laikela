import { newId, q, q1 } from "./index";
import { DEMO_ORG_ID, DEMO_USER_ID, env } from "@/lib/env";
import { hashPassword } from "@/lib/password";
import { TOOLS } from "@/lib/domain/tools";
import { PROMPTS, PROMPT_VERSION } from "@/lib/domain/prompts";
import { TEMPLATE_SPECS } from "@/lib/domain/templates";

/** 演示账号：owner@laikela.local / laikela2026 */
const DEMO_PASSWORD = "laikela2026";

/** 套餐目录：订阅决定每月发多少积分，积分决定一次任务扣多少 */
/**
 * 套餐目录。
 *
 * 定价锚点：**1 积分 = 1 分钱**，所以「月费 : 积分 = 1 : 100」，
 * 每一档都能手算核对，不存在隐藏倍率。
 *
 * 套餐之间拉开的不是「积分折扣」（那会变成价格战），而是：
 *   · 服务费率 5% → 4.5% → 4% → 3%（量大费率低，B 端惯例）
 *   · 席位与协作能力
 *   · 并发队列、OpenAPI、私有化、SLA
 *
 * 换句话说：token 按成本价转售，利润来自席位与功能，不来自加价。
 */
const DEMO_PLANS = [
  {
    code: "free",
    name: "体验版",
    tagline: "15 项能力全部开放，先把一条链路跑通",
    price: 0,
    credits: 200,
    seats: 1,
    sort: 0,
    features: [
      "15 项能力全部开放",
      "本地引擎 + 200 积分体验额度",
      "约 200 次文案 / 60 张海报",
      "素材保留 7 天",
      "单个任务最多 3 个变体",
    ],
  },
  {
    code: "creator",
    name: "创作版",
    tagline: "用多少扣多少，模型按官方成本价结算",
    price: 99,
    credits: 9900,
    seats: 1,
    sort: 1,
    features: [
      "9,900 积分 · 服务费 4.5%",
      "云端模型：DeepSeek V4 / 豆包 Seed 2.1",
      "1 积分 = 1 分钱，用量可实时核对",
      "商用授权 · 素材保留 90 天",
      "批量变体与 A/B 文案",
    ],
  },
  {
    code: "studio",
    name: "工作室",
    tagline: "5 人共用一份额度，费率降到 4%",
    price: 299,
    credits: 29900,
    seats: 5,
    sort: 2,
    features: [
      "29,900 积分 · 服务费 4%",
      "5 个席位，额度池共享",
      "品牌人设与口吻库 · 团队素材库",
      "OpenAPI 访问 · 优先队列（并发 4）",
      "用量分成员统计与预警",
    ],
  },
  {
    code: "enterprise",
    name: "企业版",
    tagline: "最低 3% 费率，席位与合规一起给",
    price: 1200,
    credits: 120000,
    seats: 30,
    sort: 3,
    features: [
      "120,000 积分 · 服务费 3%（最低档）",
      "30 个席位 · 私有化部署可选",
      "专属模型通道与私有知识库",
      "SSO、权限分级、审计日志导出",
      "SLA 99.9% · 对公发票 · 专属对接人",
    ],
  },
];

/** 幂等种子：只在首次（或显式 --force）时写入演示数据 */
export async function seedAll(force = false) {
  if (!force) {
    const flag = await q1<{ value: unknown }>(
      `select value from app_settings where key = 'seeded'`,
    );
    if (flag) {
      // 老库已建过表：仍需补齐账号口令、套餐与订阅，保证能登录
      await seedAccountAndPlans();
      return;
    }
  }

  const org = await q1<{ id: string }>(`select id from organizations where id = $1`, [
    DEMO_ORG_ID,
  ]);
  if (!org) {
    await q(
      `insert into organizations (id, name, plan, quota_month) values ($1,$2,$3,$4)
       on conflict (id) do nothing`,
      [DEMO_ORG_ID, "来客啦 · 演示空间", "studio", 2000],
    );
  }

  await seedAccountAndPlans();

  // ---- 版本化 Prompt ----
  for (const [slug, body] of Object.entries(PROMPTS)) {
    await q(
      `insert into prompt_versions (id, tool_slug, version, body, active)
       values ($1,$2,$3,$4,true)
       on conflict (tool_slug, version) do nothing`,
      [newId("prm"), slug, PROMPT_VERSION, body],
    );
  }

  // ---- 模板 DSL ----
  for (const spec of TEMPLATE_SPECS) {
    await q(
      `insert into templates (id, kind, name, version, spec, active)
       values ($1,$2,$3,$4,$5,true) on conflict (id) do nothing`,
      [spec.id, spec.kind, spec.name, spec.version, JSON.stringify(spec.spec)],
    );
  }

  // ---- 音色库 ----
  const voices: Array<[string, string, string]> = [
    ["清和 · 温柔女声", "female", "温柔"],
    ["小满 · 元气女声", "female", "元气"],
    ["砚舟 · 沉稳男声", "male", "沉稳"],
    ["Late · 磁性男声", "male", "磁性"],
    ["豆豆 · 童声", "child", "明亮"],
  ];
  for (const [name, gender, timbre] of voices) {
    const exist = await q1(`select id from voices where org_id = $1 and name = $2`, [
      DEMO_ORG_ID,
      name,
    ]);
    if (!exist) {
      await q(
        `insert into voices (id, org_id, name, gender, timbre, provider, consent_ref)
         values ($1,$2,$3,$4,$5,'local','demo-consent')`,
        [newId("vce"), DEMO_ORG_ID, name, gender, timbre],
      );
    }
  }

  // ---- 人设档案 ----
  const persona = await q1(`select id from personas where org_id = $1 limit 1`, [DEMO_ORG_ID]);
  if (!persona) {
    await q(
      `insert into personas (id, org_id, name, positioning, traits, catchphrase, boundaries)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId("psn"),
        DEMO_ORG_ID,
        "林小满的咖啡日记",
        "门店老板",
        JSON.stringify(["真诚", "克制", "专业"]),
        "说人话，讲真话",
        "不承诺功效、不贬低同行、不使用夸张绝对化用语",
      ],
    );
  }

  // ---- 热点事件 ----
  const trends: Array<[string, string, number, number]> = [
    ["抖音", "多巴胺穿搭", 98600, 42.5],
    ["小红书", "早八人的早餐", 62400, 31.2],
    ["抖音", "开学第一课", 214000, 18.7],
    ["视频号", "秋日第一杯拿铁", 38200, 25.4],
    ["小红书", "露营咖啡车", 45100, 12.9],
    ["微博", "双 11 预售攻略", 176000, 56.3],
    ["抖音", "AI 换脸避坑", 88400, 63.1],
    ["小红书", "租房改造 2000 元", 51900, 9.8],
  ];
  for (const [platform, keyword, heat, growth] of trends) {
    await q(
      `insert into trend_events (id, org_id, platform, keyword, heat, growth, confidence, source, captured_at)
       values ($1,$2,$3,$4,$5,$6,$7,'sample', now() - ($8 || ' hours')::interval)`,
      [newId("trd"), DEMO_ORG_ID, platform, keyword, heat, growth, 0.86, String(Math.round(Math.random() * 20))],
    );
  }

  // ---- 历史任务（让看板与列表一打开就有内容）----
  const jobCount = await q1<{ n: string }>(
    `select count(*)::text as n from jobs where org_id = $1`,
    [DEMO_ORG_ID],
  );
  if (!jobCount || jobCount.n === "0") {
    const statuses = ["succeeded", "succeeded", "succeeded", "succeeded", "failed", "canceled"];
    for (let i = 0; i < 46; i++) {
      const tool = TOOLS[i % TOOLS.length];
      const status = i < 6 ? statuses[i] : "succeeded";
      const hoursAgo = Math.round(6 + i * 15.6);
      const input = Object.fromEntries(
        tool.fields.map((f) => [
          f.id,
          f.type === "picks" || f.type === "select"
            ? (f.opts?.[0] ?? "")
            : f.type === "range"
              ? (f.value ?? 0)
              : `${tool.name}演示输入`,
        ]),
      );
      const jobId = newId("job");
      await q(
        `insert into jobs
          (id, org_id, tool_slug, status, stage, progress, input, output,
           model_provider, model_name, prompt_version, attempts,
           cost_cny, created_at, started_at, finished_at, error_code, error_message)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 now() - ($14 || ' hours')::interval,
                 now() - ($14 || ' hours')::interval + interval '2 seconds',
                 now() - ($14 || ' hours')::interval + interval '${tool.etaSeconds} seconds',
                 $15,$16)`,
        [
          jobId,
          DEMO_ORG_ID,
          tool.slug,
          status,
          status === "succeeded" ? "已完成" : status === "failed" ? "生成失败" : "已取消",
          status === "succeeded" ? 100 : status === "failed" ? 62 : 15,
          JSON.stringify(input),
          status === "succeeded" ? JSON.stringify({ demo: true }) : null,
          env.hasCloudProvider ? "deepseek" : "local",
          env.hasCloudProvider ? env.providers.deepseek.model : "local-sim",
          PROMPT_VERSION,
          1,
          (tool.creditCost * 0.18).toFixed(2),
          String(hoursAgo),
          status === "failed" ? "PROVIDER_TIMEOUT" : null,
          status === "failed" ? "供应商在 30 秒内未返回结果，已自动重试 1 次" : null,
        ],
      );

      if (status === "succeeded") {
        await q(
          `insert into usage_records
            (id, org_id, job_id, provider, model, unit, quantity, unit_price, currency, cost_cny, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'CNY',$9, now() - ($10 || ' hours')::interval)`,
          [
            newId("usg"),
            DEMO_ORG_ID,
            jobId,
            env.hasCloudProvider ? "deepseek" : "local",
            env.hasCloudProvider ? env.providers.deepseek.model : "local-sim",
            tool.kind === "copy" ? "k_token" : tool.kind === "image" ? "image" : tool.kind === "audio" ? "minute" : "video_second",
            tool.creditCost,
            0.018,
            (tool.creditCost * 0.18).toFixed(4),
            String(hoursAgo),
          ],
        );
      }
    }
  }

  await q(
    `insert into app_settings (key, value) values ('seeded', $1)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify({ at: new Date().toISOString() })],
  );
}

/**
 * 账号口令 + 套餐 + 演示订阅 + 历史积分流水。
 * 单独抽出来，是为了让「已经 seeded 过的老库」也能补到最新结构。
 */
async function seedAccountAndPlans() {
  const user = await q1<{ id: string; password_hash: string | null }>(
    `select id, password_hash from users where id = $1`,
    [DEMO_USER_ID],
  );
  if (user && !user.password_hash) {
    await q(
      `update users set password_hash = $2 where id = $1 and password_hash is null`,
      [DEMO_USER_ID, hashPassword(DEMO_PASSWORD)],
    );
  }
  if (!user) {
    await q(
      `insert into users (id, org_id, email, name, role, avatar_hue, password_hash)
       values ($1,$2,$3,$4,'owner',38,$5) on conflict (id) do nothing`,
      [DEMO_USER_ID, DEMO_ORG_ID, "owner@laikela.local", "林小满", hashPassword(DEMO_PASSWORD)],
    );
  }

  // ---- 套餐目录 ----
  for (const p of DEMO_PLANS) {
    await q(
      `insert into plans (code, name, tagline, price_cny, monthly_credits, seats, features, sort, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,true)
       on conflict (code) do update set
         name = excluded.name, tagline = excluded.tagline, price_cny = excluded.price_cny,
         monthly_credits = excluded.monthly_credits, seats = excluded.seats,
         features = excluded.features, sort = excluded.sort`,
      [
        p.code,
        p.name,
        p.tagline,
        p.price,
        p.credits,
        p.seats,
        JSON.stringify(p.features),
        p.sort,
      ],
    );
  }

  // ---- 演示订阅 + 积分账本 ----
  const ledgerBefore = await q1<{ id: string }>(
    `select id from credit_ledger where org_id = $1 limit 1`,
    [DEMO_ORG_ID],
  );
  const activeSub = await q1<{ id: string }>(
    `select id from subscriptions where org_id = $1 and status = 'active' limit 1`,
    [DEMO_ORG_ID],
  );
  if (!activeSub) {
    const { startSubscription } = await import("@/lib/billing");
    await startSubscription({ orgId: DEMO_ORG_ID, planCode: "studio", months: 1, channel: "mock" });
  }

  // 给历史任务补一份积分流水，让账本页一打开就有真实记录
  if (!ledgerBefore) {
    const history = await q<{
      id: string;
      tool_slug: string;
      status: string;
      credit_cost: number;
      created_at: string;
    }>(
      `select j.id, j.tool_slug, j.status, coalesce(t.credit_cost, 1) as credit_cost, j.created_at
       from jobs j left join tool_definitions t on t.slug = j.tool_slug
       where j.org_id = $1 order by j.created_at asc`,
      [DEMO_ORG_ID],
    );
    const { balance } = await import("@/lib/credits");
    let bal = await balance(DEMO_ORG_ID);
    for (const job of history) {
      const cost = Number(job.credit_cost) || 1;
      bal -= cost;
      await q(
        `insert into credit_ledger (id, org_id, job_id, kind, delta, balance_after, reason, idempotency_key, meta, created_at)
         values ($1,$2,$3,'consume',$4,$5,$6,$7,$8,$9) on conflict (idempotency_key) do nothing`,
        [
          newId("cdt"),
          DEMO_ORG_ID,
          job.id,
          -cost,
          bal,
          `生成任务 · ${job.tool_slug}`,
          `job:${job.id}:consume`,
          JSON.stringify({ credits: cost, seed: true }),
          job.created_at,
        ],
      );
      if (job.status !== "succeeded") {
        bal += cost;
        await q(
          `insert into credit_ledger (id, org_id, job_id, kind, delta, balance_after, reason, idempotency_key, meta, created_at)
           values ($1,$2,$3,'refund',$4,$5,$6,$7,$8,$9) on conflict (idempotency_key) do nothing`,
          [
            newId("cdt"),
            DEMO_ORG_ID,
            job.id,
            cost,
            bal,
            job.status === "failed" ? "任务失败自动退回" : "任务取消自动退回",
            `job:${job.id}:refund`,
            JSON.stringify({ credits: cost, seed: true }),
            job.created_at,
          ],
        );
      }
    }
  }


  await q(
    `insert into projects (id, org_id, name) values ($1,$2,$3) on conflict (id) do nothing`,
    [newId("prj"), DEMO_ORG_ID, "双 11 品牌战役"],
  );

  // ---- 工具目录 ----
  for (const [i, tool] of TOOLS.entries()) {
    await q(
      `insert into tool_definitions
         (slug, section, name, tagline, kind, eta_seconds, credit_cost, badge, enabled, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
       on conflict (slug) do update set
         section = excluded.section, name = excluded.name, tagline = excluded.tagline,
         kind = excluded.kind, eta_seconds = excluded.eta_seconds,
         credit_cost = excluded.credit_cost, badge = excluded.badge,
         sort = excluded.sort, updated_at = now()`,
      [
        tool.slug,
        tool.section,
        tool.name,
        tool.tagline,
        tool.kind,
        tool.etaSeconds,
        tool.creditCost,
        tool.badge ?? null,
        i,
      ],
    );
  }

  // ---- 模型目录运行时开关 ----
  await syncModelCatalog();
}

/**
 * 把代码里的模型目录同步进 model_catalog 表。
 *
 * 只补「缺的行」，绝不覆盖已有的 enabled / priority / credits ——
 * 运维在后台关掉的模型，不能因为重启就被重新打开。
 * 清单与单价以 src/lib/ai/catalog.ts 为准，这张表只管运行时开关。
 */
async function syncModelCatalog() {
  const { MODEL_CATALOG } = await import("@/lib/ai/catalog");
  for (const [i, m] of MODEL_CATALOG.entries()) {
    await q(
      `insert into model_catalog (key, enabled, priority, credits, note)
       values ($1, true, $2, $3, $4)
       on conflict (key) do nothing`,
      [m.key, i, m.credits, m.note],
    );
  }
}
