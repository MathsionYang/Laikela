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

  const providers = PROVIDERS.map((p) => ({
    id: p.id as string,
    label: p.label,
    available: p.available,
    local: p.id === "local",
    // 把「实际发给供应商的模型 id」也摆出来：排查 400 时第一件事就是看它对不对
    model:
      p.id === "deepseek"
        ? env.providers.deepseek.model
        : p.id === "doubao"
          ? env.providers.doubao.model
          : undefined,
  }));

  // 百炼复用 openai-chat 适配器，没有独立的 ProviderAdapter，
  // 但状态页必须能看到它 —— 否则「配了 Key 却没出现」会被误判成没接上。
  providers.splice(providers.length - 1, 0, {
    id: "bailian",
    label: "阿里百炼",
    available: Boolean(env.providers.bailian.apiKey),
    local: false,
    model: `${env.providers.bailian.textModel} / ${env.providers.bailian.imageModel}`,
  });

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
    providers,
    mode: env.hasCloudProvider ? "cloud" : "local",
  });
}
