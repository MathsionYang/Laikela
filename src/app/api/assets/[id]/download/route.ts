import type { NextRequest } from "next/server";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { storage } from "@/lib/storage";
import { contentDisposition, getAsset } from "@/lib/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 素材下载口。
 *
 * 为什么不复用 /api/files 的签名 URL：
 *   · 签名 URL 里只有存储 key（`final-1.png`），落地文件名会变成这串机器名；
 *   · 删除、鉴权都在素材这一层，下载也走这里才能校验「这个素材属于你的租户」。
 *
 * `?inline=1` 给文字预览用：走浏览器内联渲染，不触发下载。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const { id } = await params;
  const asset = await getAsset(session.orgId, id);
  if (!asset) return new Response("素材不存在或已删除", { status: 404 });

  const inline = new URL(req.url).searchParams.get("inline") === "1";

  let buf: Buffer;
  try {
    buf = await storage().get(asset.storage_key);
  } catch {
    return new Response("文件已丢失（记录还在，存储里查不到）", { status: 410 });
  }

  // 文字按 utf-8 原样给，浏览器与编辑器都不会乱码
  const mime = inline
    ? asset.mime.startsWith("text/")
      ? `${asset.mime}; charset=utf-8`
      : asset.mime
    : asset.mime || "application/octet-stream";

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": mime,
      "content-length": String(buf.length),
      "content-disposition": contentDisposition(asset.name, inline),
      "cache-control": "private, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
    },
  });
}
