import { NextResponse } from "next/server";

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiFail {
  ok: false;
  error: { code: string; message: string; detail?: unknown };
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function fail(code: string, message: string, status = 400, detail?: unknown) {
  return NextResponse.json<ApiFail>(
    { ok: false, error: { code, message, detail } },
    { status },
  );
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function withErrors<T>(fn: () => Promise<T>) {
  return fn().catch((err: Error) => {
    console.error("[api]", err);
    return fail("INTERNAL", err.message ?? "服务器错误", 500);
  });
}
