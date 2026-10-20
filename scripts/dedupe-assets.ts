/**
 * 素材去重：同一类产出只留一个示例。
 *
 * 背景：开发期反复跑测试任务，素材库里堆了 24 份「分镜 1」、28 份 timeline.json、
 * 9 份同名海报。库里看到的全是重复项，真实产出反而被淹没。
 *
 * 规则（保守，只动完全同名同类的东西）：
 *   1. 按 (kind, name) 分组，每组保留**最新**一条，其余进删除列表；
 *   2. 缩略图不参与分组 —— 它靠 meta.of 挂在父素材下，父留它留、父删它删；
 *   3. 清掉父素材已不存在的孤儿缩略图；
 *   4. 删除一律走 deleteAssets()，文件 + 数据库行 + 缩略图一起回收，并写审计日志。
 *
 * 用法：
 *   npx tsx scripts/dedupe-assets.ts                # 预演，只打印不删除
 *   npx tsx scripts/dedupe-assets.ts --apply        # 真删（会先落备份）
 *   npx tsx scripts/dedupe-assets.ts --apply --org=org_xxx
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { q } from "../src/lib/db";
import { deleteAssets } from "../src/lib/assets";

interface Row {
  id: string;
  org_id: string;
  kind: string;
  role: string;
  name: string;
  storage_key: string;
  bytes: number;
  job_id: string | null;
  created_at: Date;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgArg = args.find((a) => a.startsWith("--org="))?.slice(6) ?? null;

async function main() {
  const orgs = orgArg
    ? [orgArg]
    : (await q<{ id: string }>(`select id from organizations order by id`)).map((r) => r.id);

  const all: Row[] = [];
  for (const orgId of orgs) {
    const rows = await q<Row>(
      `select id, org_id, kind, role, name, storage_key, bytes, job_id, created_at
       from assets where org_id = $1
       order by created_at desc`,
      [orgId],
    );
    all.push(...rows);
  }

  // ---- 分组：粗体素材（成品/分镜/时间轴）才参与，缩略图跟随父素材 ----
  const groups = new Map<string, Row[]>();
  for (const r of all) {
    if (r.role === "thumbnail") continue;
    const key = `${r.org_id}\u0000${r.kind}\u0000${r.name}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const drop: Row[] = [];
  const keep: Row[] = [];
  for (const list of groups.values()) {
    keep.push(list[0]); // 已按 created_at desc 排序，首条即最新
    drop.push(...list.slice(1));
  }

  // ---- 孤儿缩略图：父素材不在保留集合里 ----
  const keepIds = new Set(keep.map((k) => k.id));
  const thumbs = await q<{
    id: string;
    org_id: string;
    name: string;
    storage_key: string;
    of: string | null;
  }>(
    `select id, org_id, name, storage_key, meta->>'of' as of
     from assets where role = 'thumbnail'`,
  );
  const orphanThumbs = thumbs.filter((t) => !t.of || !keepIds.has(t.of));
  for (const t of orphanThumbs) {
    drop.push({
      id: t.id,
      org_id: t.org_id,
      kind: "image",
      role: "thumbnail",
      name: t.name,
      storage_key: t.storage_key,
      bytes: 0,
      job_id: null,
      created_at: new Date(0),
    });
  }

  console.log(`扫描 ${all.length} 条素材 · ${groups.size} 个分组`);
  console.log(`保留 ${keep.length} 条 · 删除 ${drop.length} 条（其中孤儿缩略图 ${orphanThumbs.length}）`);
  console.log("");

  const summary = new Map<string, number>();
  for (const r of drop) {
    if (r.role === "thumbnail") continue;
    const key = `${r.kind} / ${r.name}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  const sorted = [...summary.entries()].sort((a, b) => b[1] - a[1]);
  console.log("将删除的重复项：");
  for (const [k, n] of sorted.slice(0, 25)) console.log(`  ${String(n).padStart(3)}×  ${k}`);
  if (sorted.length > 25) console.log(`  … 另 ${sorted.length - 25} 组`);

  const before = await q<{ n: string }>(`select count(*)::text n from assets`);
  console.log(`\n删除后剩余：约 ${Number(before[0].n) - drop.length} 条`);

  if (!apply) {
    console.log("\n这是预演。确认无误后加 --apply 执行（会先写备份）。");
    process.exit(0);
  }

  // ---- 备份：删之前把「留什么、删什么」全量落盘，可人工回滚 ----
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.resolve(process.cwd(), "data", "backup");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `dedupe-assets-${stamp}.json`);
  await writeFile(
    file,
    JSON.stringify({ at: new Date().toISOString(), keep, drop }, null, 2),
    "utf8",
  );
  console.log(`\n备份已写入 ${file}`);

  // ---- 真删：按租户分批，每批最多 50 ----
  let deleted = 0;
  let files = 0;
  for (const orgId of orgs) {
    const ids = drop.filter((r) => r.org_id === orgId).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      const res = await deleteAssets(orgId, ids.slice(i, i + 50), {
        id: "system",
        email: "dedupe@local",
      });
      deleted += res.length;
      files += res.reduce((n, r) => n + r.files, 0);
    }
  }

  const after = await q<{ n: string }>(`select count(*)::text n from assets`);
  console.log(`\n已删除 ${deleted} 条素材，回收 ${files} 个文件`);
  console.log(`库内剩余：${after[0].n} 条`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
