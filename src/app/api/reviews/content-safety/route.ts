import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { addModeration } from "@/lib/jobs/repo";
import { moderate } from "@/lib/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 独立的内容审查接口：可以在发布前先跑一遍 */
export async function POST(req: Request) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;
  const session = guard.session;
  const body = await readJson<{ text?: string; jobId?: string }>(req);
  const text = (body.text ?? "").trim();
  if (!text) return fail("EMPTY", "请提供待审查文本", 422);
  if (text.length > 50_000) return fail("TOO_LONG", "文本过长，请分段审查", 413);

  const verdict = moderate(text);
  await addModeration({
    orgId: session.orgId,
    jobId: body.jobId ?? null,
    target: "manual",
    level: verdict.level,
    hits: verdict.hits,
    suggestion: verdict.suggestion,
  });

  return ok(verdict);
}
