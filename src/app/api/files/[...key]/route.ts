import { verifyKey } from "@/lib/storage";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  json: "application/json",
  svg: "image/svg+xml",
};

/**
 * 短期签名 URL 的出入口。
 * 对象存储本身不公开，所有文件访问都经过这里做签名校验，
 * 这样即使桶被误配成公开，也仍然需要有效签名才能取到文件。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const path = key.map(decodeURIComponent).join("/");
  const sp = new URL(req.url).searchParams;
  const exp = Number(sp.get("exp") ?? 0);
  const sig = sp.get("sig") ?? "";

  if (!verifyKey(path, exp, sig)) {
    return new Response("链接已过期或签名无效，请刷新页面重新获取", { status: 403 });
  }

  try {
    const buf = await storage().get(path);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": String(buf.length),
        "cache-control": "private, max-age=1800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(`文件读取失败：${(err as Error).message}`, { status: 404 });
  }
}
