/**
 * 素材的文件名、缩略图与删除。
 *
 * 三条原则：
 *   1. 库里的名字是给人看的（`夏日活动海报.png`），存储 key 是给机器看的（`final-1.png`）；
 *   2. 删素材必须连文件一起删，不能只删数据库行 —— 否则本地目录会越攒越大且无法回收；
 *   3. 删图连带删它的缩略图，缩略图靠 `meta.of` 认亲。
 */
import { q, q1 } from "@/lib/db";
import { storage } from "@/lib/storage";
import { audit, type AssetRow } from "@/lib/jobs/repo";

/** 把标题洗成安全的文件名：去控制字符与路径分隔符，限长 */
export function safeFileName(input: string, fallback = "未命名"): string {
  const cleaned = String(input)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 48)
    .trim();
  return cleaned || fallback;
}

/** 下载时用的 Content-Disposition，中文名走 RFC 5987 编码 */
export function contentDisposition(name: string, inline: boolean): string {
  const safe = safeFileName(name, "download");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** 批量取缩略图：返回 父素材 id → 缩略图签名地址 */
export async function thumbMap(
  orgId: string,
  assetIds: string[],
): Promise<Map<string, { url: string; key: string }>> {
  const map = new Map<string, { url: string; key: string }>();
  if (!assetIds.length) return map;
  const rows = await q<{ storage_key: string; meta: Record<string, unknown> }>(
    `select storage_key, meta from assets
     where org_id = $1 and role = 'thumbnail' and meta->>'of' = any($2::text[])`,
    [orgId, assetIds],
  );
  const { signedUrl } = await import("@/lib/storage");
  for (const r of rows) {
    const of = String(r.meta?.of ?? "");
    if (of) map.set(of, { url: signedUrl(r.storage_key), key: r.storage_key });
  }
  return map;
}

export async function getAsset(orgId: string, id: string): Promise<AssetRow | null> {
  return q1<AssetRow>(`select * from assets where id = $1 and org_id = $2`, [id, orgId]);
}

/** 富文本 → 纯文本：编辑器里保存的是 HTML，素材库里存的是 .md */
export function htmlToPlain(html: string): string {
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "· ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 编辑器里改过文案后，把素材库那份 .md 同步成最新内容。
 * 不同步的话，「素材库里的文字」会永远停在第一次生成的样子 —— 用户下载到的是旧稿。
 */
export async function refreshTextAsset(params: {
  orgId: string;
  jobId: string;
  title: string;
  plain: string;
}): Promise<boolean> {
  const asset = await q1<AssetRow>(
    `select * from assets where org_id = $1 and job_id = $2 and kind = 'text' and role = 'final' limit 1`,
    [params.orgId, params.jobId],
  );
  if (!asset) return false;

  const body = Buffer.from(`# ${params.title}\n\n${params.plain}\n`, "utf8");
  await storage().put(asset.storage_key, body, "text/markdown");
  await q(
    `update assets set bytes = $2, name = $3, meta = meta || $4::jsonb where id = $1`,
    [
      asset.id,
      body.length,
      `${safeFileName(params.title, "文案")}.md`,
      JSON.stringify({ chars: params.plain.length, preview: params.plain.replace(/\s+/g, " ").slice(0, 180) }),
    ],
  );
  return true;
}

export interface DeletedAsset {
  id: string;
  name: string;
  files: number;
}

/**
 * 删除素材：先删文件，再删行。
 * 文件删失败也继续删行 —— 留一条「查不到文件」的僵尸记录比留一堆没有归属的文件更糟。
 */
export async function deleteAssets(
  orgId: string,
  ids: string[],
  actor: { id: string; email: string },
): Promise<DeletedAsset[]> {
  const store = storage();
  const removed: DeletedAsset[] = [];

  for (const id of ids.slice(0, 50)) {
    const asset = await getAsset(orgId, id);
    if (!asset) continue;

    // 连带它的缩略图与版本文件
    const children = await q<{ id: string; storage_key: string }>(
      `select id, storage_key from assets
       where org_id = $1 and id <> $2 and (meta->>'of' = $2 or meta->>'assetId' = $2)`,
      [orgId, asset.id],
    );
    const versions = await q<{ storage_key: string }>(
      `select storage_key from asset_versions where asset_id = $1`,
      [asset.id],
    );

    let files = 0;
    for (const key of [
      asset.storage_key,
      ...children.map((c) => c.storage_key),
      ...versions.map((v) => v.storage_key),
    ]) {
      try {
        await store.remove(key);
        files++;
      } catch (err) {
        console.warn("[assets] 删除文件失败，继续删记录：", key, (err as Error).message);
      }
    }

    await q(`delete from assets where org_id = $1 and id = any($2::text[])`, [
      orgId,
      [asset.id, ...children.map((c) => c.id)],
    ]);

    removed.push({ id: asset.id, name: asset.name, files });
  }

  if (removed.length) {
    await audit({
      orgId,
      action: "asset.deleted",
      detail: {
        count: removed.length,
        names: removed.map((r) => r.name).slice(0, 10),
        by: actor.email,
        files: removed.reduce((n, r) => n + r.files, 0),
      },
    });
  }

  return removed;
}
