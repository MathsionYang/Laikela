import { ok } from "@/lib/api";
import { env } from "@/lib/env";
import { dbHealth } from "@/lib/jobs/repo";
import { queueHealth } from "@/lib/jobs/queue";
import { storageHealth } from "@/lib/storage";
import { PROVIDERS } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis, store] = await Promise.all([dbHealth(), queueHealth(), storageHealth()]);

  return ok({
    app: { name: env.appName, sub: env.appSub },
    checks: [
      { id: "postgres", label: "PostgreSQL", ok: db.ok, detail: db.detail },
      { id: "redis", label: "Redis / 任务队列", ok: redis.ok, detail: redis.detail },
      {
        id: "storage",
        label: `对象存储（${env.storage.driver}）`,
        ok: store.ok,
        detail: store.detail,
      },
    ],
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      available: p.available,
      local: p.id === "local",
    })),
    mode: env.hasCloudProvider ? "cloud" : "local",
  });
}
