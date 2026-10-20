import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { newId } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session-api";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 上传签名。
 * S3 形态返回预签名 PUT 地址（前端直传桶，不经过应用）；
 * 本地形态返回应用的上传端点（走 multipart 代理）。
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const body = await readJson<{ name?: string; mime?: string; size?: number }>(req);
  const name = body.name ?? "upload.bin";
  const mime = body.mime ?? "application/octet-stream";
  const size = body.size ?? 0;

  if (size > 200 * 1024 * 1024) {
    return fail("TOO_LARGE", "单个文件不能超过 200MB", 413);
  }

  const ext = name.includes(".") ? name.split(".").pop() : "bin";
  const key = `${session.orgId}/uploads/${newId("up")}.${ext}`;

  if (storage().driver === "local") {
    return ok({
      mode: "proxy" as const,
      key,
      url: "/api/assets",
      method: "POST",
      note: "本地存储形态：请以 multipart/form-data 提交到 /api/assets",
    });
  }

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: env.storage.region,
    endpoint: env.storage.endpoint,
    forcePathStyle: env.storage.forcePathStyle,
    credentials: {
      accessKeyId: env.storage.accessKey,
      secretAccessKey: env.storage.secretKey,
    },
  });
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: env.storage.bucket, Key: key, ContentType: mime }),
    { expiresIn: 900 },
  );

  return ok({ mode: "direct" as const, key, url, method: "PUT", headers: { "content-type": mime } });
}
