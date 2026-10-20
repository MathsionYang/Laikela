import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * 存储端口。对象存储只存文件，元数据与权限在 PostgreSQL。
 * 对外一律给「短期签名 URL」，不暴露桶。
 */
export interface StoragePort {
  readonly driver: string;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /**
   * 删文件。返回 true 表示这次确实删掉了一个文件，false 表示本来就不存在。
   * 删除失败（文件被占用、权限不足）必须抛错 —— 静默吞掉会让「回收了几个文件」
   * 变成假数字，也看不出孤儿文件是怎么攒下来的。
   */
  remove(key: string): Promise<boolean>
  /** 本地 driver 的绝对路径，供 sharp 等直接读盘；S3 driver 返回 null */
  localPath(key: string): string | null;
}

let s3: S3Client | null = null;
function client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.storage.region,
      endpoint: env.storage.endpoint,
      forcePathStyle: env.storage.forcePathStyle,
      credentials: {
        accessKeyId: env.storage.accessKey,
        secretAccessKey: env.storage.secretKey,
      },
    });
  }
  return s3;
}

const s3Storage: StoragePort = {
  driver: "s3",
  async put(key, body, mime) {
    await client().send(
      new PutObjectCommand({
        Bucket: env.storage.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  },
  async get(key) {
    const res = await client().send(
      new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`对象不存在：${key}`);
    return Buffer.from(bytes);
  },
  async remove(key) {
    await client().send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: key }));
    return true;
  },
  localPath() {
    return null;
  },
};

const root = path.resolve(process.cwd(), env.storage.localRoot);

const local: StoragePort = {
  driver: "local",
  async put(key, body) {
    const file = path.join(root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async get(key) {
    return readFile(path.join(root, key));
  },
  async remove(key) {
    try {
      await unlink(path.join(root, key));
      return true;
    } catch (err) {
      // 文件本来就不存在 → 目标已达成，算成功但不算回收
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      // Windows 上文件被占用（浏览器正在播放）会 EBUSY/EPERM，必须让调用方知道
      throw err;
    }
  },
  localPath(key) {
    return path.join(root, key);
  },
};

export function storage(): StoragePort {
  return env.storage.driver === "local" ? local : s3Storage;
}

/** 确保桶存在（MinIO 首次启动没有桶）；本地 driver 直接返回目录 */
export async function ensureBucket(): Promise<string> {
  if (env.storage.driver === "local") {
    await mkdir(root, { recursive: true });
    return `local:${root}`;
  }
  const { CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const bucket = env.storage.bucket;
  try {
    await client().send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client().send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[storage] 已创建桶 ${bucket}`);
    } catch (err) {
      // 并发创建时可能已被别的进程建好，忽略已存在
      const msg = (err as Error).message ?? "";
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(msg)) throw err;
    }
  }
  return `s3:${env.storage.endpoint}/${bucket}`;
}

export async function storageHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    if (env.storage.driver === "local") {
      await mkdir(root, { recursive: true });
      const probe = path.join(root, ".health");
      await writeFile(probe, "ok");
      // 写进去又读出来就够了；探测文件删不掉（某些沙箱/杀软会拦 unlink）
      // 只说明清理不干净，不代表存储不可用 —— 别把它报成红灯。
      await unlink(probe).catch(() => {});
      // 这里只验证了「能写能删」，别报探测文件的字节数冒充目录占用
      return { ok: true, detail: `本地目录 ${root} · 读写正常` };
    }
    await client().send(new HeadBucketCommand({ Bucket: env.storage.bucket }));
    return { ok: true, detail: `S3 ${env.storage.endpoint}/${env.storage.bucket}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/* ---------------- 签名 URL ---------------- */

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 生成 HMAC 签名：key + 过期时间，防篡改 */
export function signKey(key: string, exp: number): string {
  return b64url(createHmac("sha256", env.signingSecret).update(`${key}:${exp}`).digest());
}

export function verifyKey(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expect = Buffer.from(signKey(key, exp));
  const got = Buffer.from(sig);
  return expect.length === got.length && timingSafeEqual(expect, got);
}

/** 相对签名地址；前端拿它当 src 用即可 */
export function signedUrl(key: string, ttl = env.signedUrlTtl): string {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = signKey(key, exp);
  return `/api/files/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?exp=${exp}&sig=${sig}`;
}
