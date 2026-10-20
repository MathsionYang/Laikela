import { fail } from "@/lib/api";
import { getSession, type SessionUser } from "@/lib/auth";

/**
 * 接口层的会话守卫。
 * 用返回值而不是抛异常，避免 SSE 这类长连接里异常被吞掉。
 */
export async function requireSession(): Promise<{ session: SessionUser } | { error: Response }> {
  const session = await getSession();
  if (!session) return { error: fail("UNAUTHORIZED", "请先登录", 401) };
  return { session };
}

/** 平台管理员守卫（跨租户）。与租户内 role 无关，只看 users.is_admin。 */
export async function requireAdminSession(): Promise<
  { session: SessionUser } | { error: Response }
> {
  const session = await getSession();
  if (!session) return { error: fail("UNAUTHORIZED", "请先登录", 401) };
  if (!session.isAdmin) return { error: fail("FORBIDDEN", "需要平台管理员权限", 403) };
  return { session };
}
