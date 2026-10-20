/**
 * 一次性数据迁移。
 *
 * schema.sql 只管结构（幂等 DDL），凡是「只该执行一次的数据回填」放这里：
 * 用 app_settings 里的 key 打标记，跑过就不再跑。
 *
 * 为什么不写在 schema.sql：SQL 里的 UPDATE 无法区分「存量行」和「刚插入的行」，
 * 一条 `update ... where is null` 会在每次启动时把新注册的未验证账号顺手验证掉。
 */
import { newId, q, q1 } from "@/lib/db";

const MARK = "migration:users.email_verified_at";
const COPY_ASSET_MARK = "migration:copy_documents.text_asset";
const PURGE_DEMO_MARK = "migration:purge_demo_content";

async function once(key: string, fn: () => Promise<void>): Promise<boolean> {
  const done = await q1<{ key: string }>(`select key from app_settings where key = $1`, [key]);
  if (done) return false;
  await fn();
  await q(
    `insert into app_settings (key, value) values ($1, '{"done":true}'::jsonb)
     on conflict (key) do update set value = '{"done":true}'::jsonb, updated_at = now()`,
    [key],
  );
  return true;
}

export async function runMigrations(): Promise<string[]> {
  const applied: string[] = [];

  // 邮箱验证上线前注册的账号，出生时就不存在"验证"这个概念，
  // 不该被新规则锁在门外 —— 统一标记为已验证。
  if (
    await once(MARK, async () => {
      await q(`update users set email_verified_at = now() where email_verified_at is null`);
    })
  ) {
    applied.push(MARK);
    console.log("[db] 已回填存量账号的邮箱验证状态");
  }

  // 文案此前只进 copy_documents，素材库里看不到、也下载不了。
  // 把存量文档补成 .md 素材（文件 + 素材行），新任务由流水线直接写。
  if (
    await once(COPY_ASSET_MARK, async () => {
      const { storage } = await import("@/lib/storage");
      const { safeFileName } = await import("@/lib/assets");
      const rows = await q<{
        id: string;
        org_id: string;
        job_id: string | null;
        tool_slug: string;
        title: string;
        structured: { plain?: string } | null;
      }>(
        `select d.id, d.org_id, d.job_id, d.tool_slug, d.title, d.structured
         from copy_documents d
         where not exists (
           select 1 from assets a where a.job_id = d.job_id and a.kind = 'text'
         )
         order by d.created_at desc
         limit 1000`,
      );

      let n = 0;
      for (const r of rows) {
        const plain = String(r.structured?.plain ?? "");
        if (!plain) continue;
        const body = Buffer.from(`# ${r.title}\n\n${plain}\n`, "utf8");
        const key = r.job_id
          ? `${r.org_id}/jobs/${r.job_id}/final.md`
          : `${r.org_id}/docs/${r.id}.md`;
        await storage().put(key, body, "text/markdown");
        await q(
          `insert into assets (id, org_id, job_id, kind, role, name, mime, bytes, storage_key, meta)
           values ($1,$2,$3,'text','final',$4,'text/markdown',$5,$6,$7)`,
          [
            newId("ast"),
            r.org_id,
            r.job_id,
            `${safeFileName(r.title, "文案")}.md`,
            body.length,
            key,
            JSON.stringify({
              docId: r.id,
              tool: r.tool_slug,
              chars: plain.length,
              preview: plain.replace(/\s+/g, " ").slice(0, 180),
              backfilled: true,
            }),
          ],
        );
        n++;
      }
      if (n) console.log(`[db] 已把 ${n} 篇存量文案补成素材`);
    })
  ) {
    applied.push(COPY_ASSET_MARK);
  }

  // 清掉演示占位数据：46 条编造的历史任务、8 条 sample 热点、假凭证。
  //
  // 为什么必须删而不是"留着也无所谓"：
  //   1. 演示任务的 output.demo='true'，会被统计任务误当成真实样本 ——
  //      云端实测耗时曾被这批 0.1 秒的假任务拉成中位数，报价跟着失真。
  //   2. 假 Key（fake••••cdef）状态是 error，用户选中它必然 401 再降级，
  //      界面却显示"你的 Key"，等于把故障伪装成配置。
  // 删之前先导一份 JSON 备份，删错能捞回来。
  if (
    await once(PURGE_DEMO_MARK, async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");

      const demoJobs = await q<{ id: string; org_id: string }>(
        `select id, org_id from jobs where output->>'demo' = 'true'`,
      );
      const ids = demoJobs.map((j) => j.id);

      const [jobs, usage, assets, docs, trends, creds] = await Promise.all([
        ids.length
          ? q(`select * from jobs where id = any($1::text[])`, [ids])
          : Promise.resolve([]),
        ids.length
          ? q(`select * from usage_records where job_id = any($1::text[])`, [ids])
          : Promise.resolve([]),
        ids.length
          ? q(`select * from assets where job_id = any($1::text[])`, [ids])
          : Promise.resolve([]),
        ids.length
          ? q(`select * from copy_documents where job_id = any($1::text[])`, [ids])
          : Promise.resolve([]),
        q(`select * from trend_events where source = 'sample'`),
        q(`select id, org_id, provider, key_hint, status from provider_credentials where key_hint like '%fake%'`),
      ]);

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = path.join(process.cwd(), "data", "backup");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `purge-demo-${stamp}.json`),
        JSON.stringify({ jobs, usage, assets, docs, trends, creds }, null, 2),
        "utf8",
      );

      // 素材走 deleteAssets：它连存储文件、缩略图、版本一起回收，
      // 直接 delete from assets 会留下无法追踪的孤儿文件。
      if (assets.length) {
        const { deleteAssets } = await import("@/lib/assets");
        const byOrg = new Map<string, string[]>();
        for (const a of assets as Array<{ id: string; org_id: string }>) {
          const list = byOrg.get(a.org_id) ?? [];
          list.push(a.id);
          byOrg.set(a.org_id, list);
        }
        const actor = { id: "system", email: "system@laikela.local" };
        for (const [orgId, list] of byOrg) {
          for (let i = 0; i < list.length; i += 50) {
            await deleteAssets(orgId, list.slice(i, i + 50), actor);
          }
        }
      }

      if (ids.length) {
        await q(`delete from copy_documents where job_id = any($1::text[])`, [ids]);
        await q(`delete from usage_records where job_id = any($1::text[])`, [ids]);
        await q(`delete from job_attempts where job_id = any($1::text[])`, [ids]);
        await q(`delete from assets where job_id = any($1::text[])`, [ids]);
        await q(`delete from jobs where id = any($1::text[])`, [ids]);
      }
      await q(`delete from trend_events where source = 'sample'`);
      await q(`delete from provider_credentials where key_hint like '%fake%'`);

      console.log(
        `[db] 已清理演示占位：${ids.length} 个任务 / ${usage.length} 条用量 / ${assets.length} 个素材 / ` +
          `${trends.length} 条 sample 热点 / ${creds.length} 把假凭证；备份 data/backup/purge-demo-${stamp}.json`,
      );
    })
  ) {
    applied.push(PURGE_DEMO_MARK);
  }

  // 平台管理员引导：ADMIN_EMAILS="a@x.com,b@y.com" 里的账号自动提权。
  // 天然幂等（只在 is_admin=false 时更新），所以不走 once()。
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length) {
    const rows = await q<{ id: string }>(
      `update users set is_admin = true
       where lower(email) = any($1::text[]) and is_admin = false
       returning id`,
      [admins],
    );
    if (rows.length) {
      applied.push("bootstrap:ADMIN_EMAILS");
      console.log(`[db] 已按 ADMIN_EMAILS 提升 ${rows.length} 个平台管理员`);
    }
  }

  return applied;
}
