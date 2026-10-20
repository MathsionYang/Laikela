import type { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/api";
import { ensureDb } from "@/lib/db";
import { requireSession } from "@/lib/session-api";
import { env } from "@/lib/env";
import { listPlans } from "@/lib/billing";
import {
  cancelClaim,
  listOrgClaims,
  submitClaim,
  PaymentError,
  type ManualChannel,
} from "@/lib/manual-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 我的转账记录 + 收款信息 + 可选套餐 */
export async function GET() {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;

  const [claims, plans] = await Promise.all([
    listOrgClaims(guard.session.orgId, 20),
    listPlans(),
  ]);

  return ok({
    claims,
    plans,
    payTo: {
      payee: env.payment.payee,
      wechat: env.payment.wechat,
      alipay: env.payment.alipay,
      bank: env.payment.bank,
      contact: env.payment.contact,
      note: env.payment.note,
    },
  });
}

/** 提交转账申报：只记录用户填的内容，权益由管理员复核后发放 */
export async function POST(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;

  const body = await readJson<{
    amountCny?: number;
    channel?: ManualChannel;
    planCode?: string;
    months?: number;
    payerName?: string;
    transferNo?: string;
    note?: string;
    proofUrl?: string;
  }>(req);

  const channel = (body.channel ?? "wechat") as ManualChannel;
  if (!["wechat", "alipay", "bank"].includes(channel)) {
    return fail("INVALID_CHANNEL", "请选择转账方式", 422);
  }

  try {
    const claim = await submitClaim({
      session: guard.session,
      amountCny: Number(body.amountCny ?? 0),
      channel,
      planCode: body.planCode ?? null,
      months: Number(body.months ?? 1),
      payerName: body.payerName,
      transferNo: body.transferNo,
      note: body.note,
      proofUrl: body.proofUrl,
    });
    return ok({ claim }, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError) return fail(err.code, err.message, err.status);
    console.error("[billing/manual-transfer]", err);
    return fail("INTERNAL", "提交失败，请稍后再试", 500);
  }
}

/** 撤销自己还没被处理的申报 */
export async function PATCH(req: NextRequest) {
  await ensureDb();
  const guard = await requireSession();
  if ("error" in guard) return guard.error;

  const body = await readJson<{ id?: string }>(req);
  if (!body.id) return fail("MISSING_FIELDS", "缺少单号", 422);

  try {
    await cancelClaim({ session: guard.session, id: body.id });
    return ok({ canceled: true });
  } catch (err) {
    if (err instanceof PaymentError) return fail(err.code, err.message, err.status);
    console.error("[billing/manual-transfer:PATCH]", err);
    return fail("INTERNAL", "撤销失败", 500);
  }
}
