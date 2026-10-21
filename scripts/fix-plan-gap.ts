/**
 * 一次性修复：把各租户「本月应得额度」补到当前套餐额度。
 *
 * 背景：`startSubscription` 早期用 `grant:{org}:{月}` 做幂等键，同一自然月内
 * 换套餐时新套餐的月度积分会被整月幂等挡掉。典型症状是「后台改成企业版了，
 * 界面还是 200 积分、下单报积分不足」。代码已改成按差额补齐（topUpMonthly），
 * 但已经升级过的租户还差着那笔，用这个脚本补。
 *
 * 默认只预演，加 --apply 才写流水。
 *   npx tsx scripts/fix-plan-gap.ts
 *   npx tsx scripts/fix-plan-gap.ts --apply
 */
import "dotenv/config";
import { ensureDb, q } from "@/lib/db";
import { getPlan } from "@/lib/billing";
import { topUpMonthly, balance } from "@/lib/credits";

interface Row {
  org_id: string;
  name: string;
  plan_code: string;
  already: string;
  used: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  await ensureDb();

  const rows = await q<Row>(
    `select o.id as org_id, o.name, s.plan_code,
            coalesce((select sum(delta) from credit_ledger l
                       where l.org_id = o.id and l.kind = 'grant'
                         and l.created_at >= date_trunc('month', now())), 0)::text as already,
            coalesce((select -sum(delta) from credit_ledger l
                       where l.org_id = o.id and l.kind = 'consume'
                         and l.created_at >= date_trunc('month', now())), 0)::text as used
       from organizations o
       join subscriptions s on s.org_id = o.id and s.status = 'active'
      order by o.created_at`,
  );

  if (!rows.length) {
    console.log("没有 active 订阅的租户，无需处理。");
    return;
  }

  const d = new Date();
  const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  let totalGap = 0;
  const pending: Array<{ orgId: string; plan: string; target: number; gap: number; name: string }> = [];

  console.log(`${apply ? "【执行】" : "【预演】"}本月 ${monthKey}\n`);
  console.log(
    "租户".padEnd(26) + "套餐".padEnd(12) + "已发".padStart(8) + "应得".padStart(8) + "差额".padStart(8) + "   余额",
  );
  console.log("-".repeat(82));

  for (const r of rows) {
    const plan = await getPlan(r.plan_code);
    const target = plan?.monthlyCredits ?? 0;
    const already = Number(r.already);
    const gap = Math.max(0, target - already);
    const bal = await balance(r.org_id);
    totalGap += gap;
    if (gap > 0) pending.push({ orgId: r.org_id, plan: r.plan_code, target, gap, name: r.name });

    const label = `${r.name}(${r.org_id})`.slice(0, 25);
    console.log(
      label.padEnd(26) +
        r.plan_code.padEnd(12) +
        String(already).padStart(8) +
        String(target).padStart(8) +
        (gap > 0 ? String(gap).padStart(8) : "—".padStart(8)) +
        `   ${bal}`,
    );
  }

  console.log("-".repeat(82));
  console.log(`合计需补 ${totalGap} 积分，涉及 ${pending.length} 个租户`);

  if (!pending.length) {
    console.log("\n所有租户本月额度都已到位，无需补发。");
    return;
  }

  if (!apply) {
    console.log("\n这是预演。确认无误后加 --apply 执行：");
    console.log("  npx tsx scripts/fix-plan-gap.ts --apply");
    return;
  }

  console.log("");
  for (const p of pending) {
    const res = await topUpMonthly({
      orgId: p.orgId,
      target: p.target,
      reason: `套餐额度补齐 · ${monthKey}（修复同月换套餐漏发）`,
      key: `fix:plan-gap:${p.orgId}:${monthKey}:${p.plan}`,
      meta: { fix: "plan-gap", planCode: p.plan, target: p.target },
    });
    console.log(`✓ ${p.name}：补 ${res.granted}，余额 ${res.balance}`);
  }
  console.log("\n完成。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
