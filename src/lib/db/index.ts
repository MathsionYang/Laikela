/**
 * 数据访问层。两种后端共用同一套 PostgreSQL SQL：
 *
 *  - postgres：真正的 PostgreSQL（docker compose 提供），生产形态
 *  - pglite  ：嵌入式 PostgreSQL（WASM），零外部依赖，用于本机无 Docker 时直接跑通
 *
 * DB_DRIVER=auto 时先探测 PostgreSQL，2.5 秒内连不上就自动降级到 pglite，
 * 这样同一份代码既能上生产，也能在裸机上 `npm run dev` 直接打开。
 */
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

export type DbSource = "postgres" | "pglite";

/** 你只需要这一个能力：带参数的查询，返回行数组 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

interface Driver extends Queryable {
  source: DbSource;
  detail: string;
  /** 多语句 DDL（建表脚本），不走参数化 */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (c: Queryable) => Promise<T>): Promise<T>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __laikelaDb: Promise<Driver> | undefined;
  // eslint-disable-next-line no-var
  var __laikelaDbReady: Promise<void> | undefined;
}

function pgDriver(): Promise<Driver> {
  return (async () => {
    const { Pool } = await import("pg");
    const p = new Pool({
      connectionString: env.databaseUrl,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_500,
    });
    p.on("error", (err) => console.error("[db] idle client error", err.message));

    // 探测：连不上就抛错，由调用方决定是否降级
    await p.query("select 1");

    const safeUrl = env.databaseUrl.replace(/\/\/[^@]*@/, "//");
    return {
      source: "postgres" as const,
      detail: `PostgreSQL · ${safeUrl}`,
      query: async <T,>(text: string, params: unknown[] = []) =>
        (await p.query(text, params as never[])).rows as T[],
      exec: async (sql: string) => {
        await p.query(sql);
      },
      tx: async <T,>(fn: (c: Queryable) => Promise<T>) => {
        const c = await p.connect();
        try {
          await c.query("BEGIN");
          const out = await fn({
            query: async <R,>(text: string, params: unknown[] = []) =>
              (await c.query(text, params as never[])).rows as R[],
          });
          await c.query("COMMIT");
          return out;
        } catch (err) {
          await c.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          c.release();
        }
      },
      health: async () => {
        try {
          const r = await p.query<{ v: string }>("select version() as v");
          return { ok: true, detail: r.rows[0]?.v.split(",")[0] ?? "PostgreSQL" };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      },
    } satisfies Driver;
  })();
}

function pgliteDriver(): Promise<Driver> {
  return (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = path.resolve(process.cwd(), env.pgliteDir);
    mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    await pg.waitReady;

    // PGlite 是单连接：事务必须串行，否则 BEGIN/COMMIT 会互相穿插
    let chain: Promise<unknown> = Promise.resolve();
    const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
      const run = chain.then(fn, fn);
      chain = run.catch(() => undefined);
      return run;
    };

    return {
      source: "pglite" as const,
      detail: `PGlite · ${path.relative(process.cwd(), dir) || "."}`,
      query: async <T,>(text: string, params: unknown[] = []) => {
        const r = await pg.query<T>(text, params);
        return r.rows;
      },
      exec: async (sql: string) => {
        await pg.exec(sql);
      },
      tx: <T,>(fn: (c: Queryable) => Promise<T>) =>
        serial(async () => {
          await pg.exec("BEGIN");
          try {
            const out = await fn({
              query: async <R,>(text: string, params: unknown[] = []) =>
                (await pg.query<R>(text, params)).rows,
            });
            await pg.exec("COMMIT");
            return out;
          } catch (err) {
            await pg.exec("ROLLBACK").catch(() => {});
            throw err;
          }
        }),
      health: async () => {
        try {
          await pg.query("select 1");
          return { ok: true, detail: `PGlite（嵌入式 PostgreSQL）· ${env.pgliteDir}` };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      },
    } satisfies Driver;
  })();
}

export function db(): Promise<Driver> {
  if (!globalThis.__laikelaDb) {
    globalThis.__laikelaDb = (async () => {
      if (env.dbDriver === "pglite") return pgliteDriver();
      if (env.dbDriver === "postgres") return pgDriver();
      // auto：优先真库，失败静默降级
      try {
        return await pgDriver();
      } catch (err) {
        console.warn(
          `[db] PostgreSQL 不可用（${(err as Error).message}），已降级到 PGlite。` +
            `生产环境请执行 npm run infra:up 或设置 DATABASE_URL。`,
        );
        return pgliteDriver();
      }
    })().catch((err) => {
      globalThis.__laikelaDb = undefined;
      throw err;
    });
  }
  return globalThis.__laikelaDb;
}

export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db()).query<T>(text, params);
}

export async function q1<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
  return (await db()).tx(fn);
}

export async function dbHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    return await (await db()).health();
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** 当前实际使用的数据库形态，界面上用于标注"演示模式" */
export async function dbSource(): Promise<{ source: DbSource; detail: string }> {
  const d = await db();
  return { source: d.source, detail: d.detail };
}

export const newId = (prefix: string) =>
  `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;

export const nowIso = () => new Date().toISOString();

/**
 * 建表 + 种子数据。幂等，dev 下每次启动都会走一次
 * （先用 app_settings.seeded 标记短路，避免重复写种子）
 */
export function ensureDb(): Promise<void> {
  if (!globalThis.__laikelaDbReady) {
    globalThis.__laikelaDbReady = runEnsureDb().catch((err) => {
      globalThis.__laikelaDbReady = undefined;
      throw err;
    });
  }
  return globalThis.__laikelaDbReady;
}

async function runEnsureDb() {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  await (await db()).exec(sql);
  const { seedAll } = await import("@/lib/db/seed");
  await seedAll();
}
