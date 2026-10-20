/**
 * 发信层。两种驱动：
 *
 *  - smtp   ：配置 SMTP_HOST/SMTP_USER/SMTP_PASS 后真实投递（nodemailer）
 *  - outbox ：未配置时把正文落到 mail_outbox 表并打到控制台。
 *             这不是"假装成功"——邮件内容、收件人、时间全都留痕，
 *             调 API 还能拿到 devCode 直接完成闭环，本机不需要真实邮箱。
 *
 * 不做重试队列：验证码是短命凭证，投递失败让用户点「重新发送」比后台重试更简单，
 * 也避免一封旧码在新码之后到达造成的串号。
 */
import { env } from "@/lib/env";
import { newId, q } from "@/lib/db";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  driver: "smtp" | "outbox";
  messageId: string | null;
  /** 真实投递失败时的原因；outbox 恒为 null */
  error: string | null;
}

type Transport = {
  sendMail: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __laikelaMailer: Transport | undefined;
}

async function transport(): Promise<Transport> {
  if (globalThis.__laikelaMailer) return globalThis.__laikelaMailer;
  const { createTransport } = await import("nodemailer");
  const t = createTransport({
    host: env.mail.smtp.host,
    port: env.mail.smtp.port,
    secure: env.mail.smtp.secure,
    auth: env.mail.smtp.user
      ? { user: env.mail.smtp.user, pass: env.mail.smtp.pass }
      : undefined,
    // 云厂商 SMTP 常见自签/中间证书问题，这里只要求 TLS 能建起来
    tls: { minVersion: "TLSv1.2" },
  });
  globalThis.__laikelaMailer = t as unknown as Transport;
  return globalThis.__laikelaMailer;
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const id = newId("mail");

  if (env.mail.driver === "smtp" && env.mail.smtp.host) {
    try {
      const t = await transport();
      const info = await t.sendMail({
        from: env.mail.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      await q(
        `insert into mail_outbox (id, to_addr, subject, body, driver, message_id)
         values ($1,$2,$3,$4,'smtp',$5)`,
        [id, msg.to, msg.subject, msg.text, info.messageId ?? null],
      );
      return { driver: "smtp", messageId: info.messageId ?? null, error: null };
    } catch (err) {
      const reason = (err as Error).message;
      console.error("[mail] SMTP 投递失败，已落 outbox：", reason);
      await q(
        `insert into mail_outbox (id, to_addr, subject, body, driver, error)
         values ($1,$2,$3,$4,'smtp',$5)`,
        [id, msg.to, msg.subject, msg.text, reason],
      );
      // 不抛：注册流程不该因为邮件服务抖动而整体失败，
      // 用户仍可点「重新发送」，管理员也能在 outbox 里捞到内容。
      return { driver: "smtp", messageId: null, error: reason };
    }
  }

  await q(
    `insert into mail_outbox (id, to_addr, subject, body, driver) values ($1,$2,$3,$4,'outbox')`,
    [id, msg.to, msg.subject, msg.text],
  );
  console.warn(
    `\n┌─ [mail/outbox] 未配置 SMTP，邮件未真正发出 ─────────────\n` +
      `│ to      : ${msg.to}\n` +
      `│ subject : ${msg.subject}\n` +
      `│ body    : ${msg.text.replace(/\n/g, "\n│           ")}\n` +
      `└───────────────────────────────────────────────────────\n`,
  );
  return { driver: "outbox", messageId: null, error: null };
}

/** 最近发出的信（本机调试用；生产请关掉或加权限） */
export async function recentOutbox(limit = 20) {
  return q<{
    id: string;
    to_addr: string;
    subject: string;
    body: string;
    driver: string;
    error: string | null;
    created_at: string;
  }>(
    `select id, to_addr, subject, body, driver, error, created_at
     from mail_outbox order by created_at desc limit $1`,
    [Math.min(limit, 100)],
  );
}
