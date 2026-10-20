import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { ensureDb, newId } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { addAsset, audit, listAssets } from "@/lib/jobs/repo";
import { clientAsset } from "@/lib/jobs/serialize";
import { storage } from "@/lib/storage";
import { probeImage } from "@/lib/media/image";
import { thumbMap } from "@/lib/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

function kindOf(mime: string): { kind: string; ext: string } {
  if (mime.startsWith("image/")) return { kind: "image", ext: mime.split("/")[1] ?? "png" };
  if (mime.startsWith("video/")) return { kind: "video", ext: mime.split("/")[1] ?? "mp4" };
  if (mime.startsWith("audio/")) return { kind: "audio", ext: mime.split("/")[1] ?? "mp3" };
  if (mime.startsWith("text/")) return { kind: "text", ext: mime.split("/")[1] ?? "txt" };
  return { kind: "document", ext: "bin" };
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const sp = req.nextUrl.searchParams;
  const rows = await listAssets(session.orgId, {
    limit: Number(sp.get("limit") ?? 120),
    kind: sp.get("kind") ?? undefined,
    role: sp.get("role") ?? undefined,
    jobId: sp.get("job") ?? undefined,
  });

  // 缩略图单独查一次再挂上去：列表要的是 240px 的小图，
  // 直接拖 1080px 的成品会在素材多的账号上变成几百 MB 流量。
  const thumbs = await thumbMap(
    session.orgId,
    rows.filter((r) => r.role !== "thumbnail").map((r) => r.id),
  );
  return ok(rows.map((r) => clientAsset(r, thumbs.get(r.id)?.url ?? null)));
}

/** 素材上传：multipart，写入对象存储并登记元数据 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("BAD_FORM", "请以 multipart/form-data 上传", 400);
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return fail("NO_FILE", "没有收到文件", 400);

  const created = [];
  for (const file of files.slice(0, 10)) {
    if (file.size > MAX_BYTES) {
      return fail("TOO_LARGE", `「${file.name}」超过 200MB 限制`, 413);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const { kind, ext } = kindOf(file.type || "application/octet-stream");
    const key = `${session.orgId}/uploads/${newId("up")}.${ext}`;
    await storage().put(key, buf, file.type || "application/octet-stream");

    let width: number | undefined;
    let height: number | undefined;
    if (kind === "image") {
      try {
        const size = await probeImage(buf);
        width = size.width;
        height = size.height;
      } catch {
        /* 非图片或不支持的格式，忽略尺寸 */
      }
    }

    const asset = await addAsset({
      orgId: session.orgId,
      jobId: null,
      kind,
      role: "original",
      name: file.name,
      mime: file.type || "application/octet-stream",
      body: buf,
      storageKey: key,
      width,
      height,
      meta: { originalName: file.name, uploadedAt: new Date().toISOString() },
    });
    created.push(clientAsset(asset));
  }

  await audit({
    orgId: session.orgId,
    action: "asset.uploaded",
    detail: { count: created.length },
  });

  return ok(created, { status: 201 });
}
