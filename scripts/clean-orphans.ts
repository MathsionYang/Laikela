/**
 * 孤儿文件回收。
 *
 * 场景：删素材时如果文件被占用（Windows 上正在播放的视频）或权限不足，
 * 数据库行会照删、文件留在盘上 —— 这是有意的取舍（留着查不到的文件
 * 比留一条点不开的记录好），但得有个口子把它们扫出来清掉。
 *
 * 判定：磁盘上存在、但 `assets.storage_key` 与 `asset_versions.storage_key`
 * 都没引用的文件，就是孤儿。
 *
 * 用法：
 *   npx tsx scripts/clean-orphans.ts             # 预演，只统计
 *   npx tsx scripts/clean-orphans.ts --apply     # 真删
 */
import "dotenv/config";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { q } from "../src/lib/db";

const root = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_ROOT ?? "data/storage");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const files = await walk(root).catch(() => [] as string[]);
  if (!files.length) {
    console.log("存储目录为空或不存在：", root);
    process.exit(0);
  }

  const keys = new Set(
    (await q<{ storage_key: string }>(`select storage_key from assets`)).map((r) => r.storage_key),
  );
  for (const v of await q<{ storage_key: string }>(`select storage_key from asset_versions`)) {
    keys.add(v.storage_key);
  }

  const orphans: { key: string; file: string; bytes: number }[] = [];
  for (const f of files) {
    const key = path.relative(root, f).split(path.sep).join("/");
    if (keys.has(key)) continue;
    orphans.push({ key, file: f, bytes: (await stat(f)).size });
  }

  const totalMb = orphans.reduce((n, o) => n + o.bytes, 0) / 1024 / 1024;
  console.log(
    `磁盘 ${files.length} 个文件 · 库内引用 ${keys.size} 个 · 孤儿 ${orphans.length} 个（${totalMb.toFixed(1)} MB）`,
  );
  for (const o of orphans.slice(0, 20)) console.log(`  ${(o.bytes / 1024).toFixed(0)} KB  ${o.key}`);
  if (orphans.length > 20) console.log(`  … 另 ${orphans.length - 20} 个`);

  if (!apply || !orphans.length) {
    if (orphans.length) console.log("\n预演。加 --apply 清理。");
    process.exit(0);
  }

  let n = 0;
  let bytes = 0;
  for (const o of orphans) {
    try {
      await unlink(o.file);
      n++;
      bytes += o.bytes;
    } catch (err) {
      console.warn(`  删除失败 ${o.key}：${(err as Error).message}`);
    }
  }
  console.log(`\n已删除 ${n} 个孤儿文件，回收 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
