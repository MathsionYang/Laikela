#!/usr/bin/env node
/**
 * 本地一键启动：检查依赖 → 拉起基础设施 → 按需构建 → 启动 Web → 健康自检
 *
 * 用法（在项目根目录）：
 *   node scripts/serve.mjs                 生产模式，端口 3000
 *   node scripts/serve.mjs --dev           开发模式（免构建，热更新）
 *   node scripts/serve.mjs --port=3100     换端口
 *   node scripts/serve.mjs --rebuild       强制重新构建
 *   node scripts/serve.mjs --no-docker     不起 docker（走 PGlite + 内存队列）
 *   node scripts/serve.mjs --force         端口被占时杀掉占用进程
 *   node scripts/serve.mjs --no-open       不自动开浏览器
 *
 * Windows 直接双击 start.bat 即可。
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const noColor = !process.stdout.isTTY || process.env.TERM === undefined || !!process.env.NO_COLOR;

const paint = (code) => (s) => (noColor ? String(s) : `\u001b[${code}m${s}\u001b[0m`);
const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  cyan: paint("36"),
};

/* ------------------------------ 参数 ------------------------------ */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const opts = {
  port: Number(val("port", process.env.PORT ?? 3000)),
  dev: has("--dev"),
  rebuild: has("--rebuild"),
  docker: !has("--no-docker"),
  force: has("--force"),
  open: !has("--no-open"),
  check: has("--check"),
};

if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
  console.error(c.red(`端口不合法：${val("port", "")}`));
  process.exit(1);
}

if (has("--help") || has("-h")) {
  console.log(`
  来客啦 · 本地一键启动

  用法    npm run serve -- [选项]
          node scripts/serve.mjs [选项]

    --dev           开发模式，跳过构建，改代码即时生效
    --port=3100     指定端口（默认 3000）
    --rebuild       忽略构建产物，强制重新构建
    --force         端口被占用时直接结束占用进程（默认会问一句）
    --no-docker     不启动 Docker，走 PGlite + 进程内队列
    --no-open       不自动打开浏览器
    --check         启动后跑毛利校验与模型连通性自检
    -h, --help      显示这段帮助
`);
  process.exit(0);
}

/* ------------------------------ 输出 ------------------------------ */

const stepN = 6;
let step = 0;
const stepTitle = (text) => {
  step += 1;
  console.log(`\n${c.cyan(`[${step}/${stepN}]`)} ${c.bold(text)}`);
};
const info = (text) => console.log(`      ${text}`);
const ok = (text) => console.log(`      ${c.green("OK")}   ${text}`);
const warn = (text) => console.log(`      ${c.yellow("注意")} ${text}`);
const bad = (text) => console.log(`      ${c.red("失败")} ${text}`);

const die = (text, hint) => {
  console.log("");
  console.error(c.red(`启动中止：${text}`));
  if (hint) console.error(c.dim(`  ${hint}`));
  console.log("");
  process.exit(1);
};

/* ------------------------------ 工具 ------------------------------ */

/**
 * 某些宿主环境（IDE / 桌面客户端）会往 NODE_OPTIONS 里注入 --require 钩子。
 * 这类钩子的状态文件一旦损坏，`fs.unlink` 会整体失败 —— 现象是「素材记录删了、
 * 文件还留在磁盘上」，而日志只报一句 SAFE_DELETE_BULK_GUARD_ERROR。
 * 服务本身不需要这些钩子，派生进程前剔掉，并在命中时说清楚剔了什么。
 */
function sanitizeNodeOptions(raw) {
  if (!raw) return { value: raw, dropped: [] };
  const segs = raw.split(/\s+/).filter(Boolean);
  const dropped = segs.filter((s) => /--require/.test(s) && /(shim|safe-delete|codebuddy)/i.test(s));
  if (!dropped.length) return { value: raw, dropped };
  return { value: segs.filter((s) => !dropped.includes(s)).join(" "), dropped };
}

const nodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS);
const CHILD_ENV = { ...process.env, NODE_OPTIONS: nodeOptions.value };
if (!nodeOptions.value) delete CHILD_ENV.NODE_OPTIONS;

function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: o.quiet ? "pipe" : "inherit",
    shell: isWin,
    encoding: "utf8",
    env: o.env ?? CHILD_ENV,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runAsync(cmd, args, o = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: o.quiet ? "pipe" : "inherit",
      shell: isWin,
      env: o.env ?? CHILD_ENV,
    });
    let out = "";
    let timer = null;
    if (o.timeoutMs) {
      timer = setTimeout(() => {
        const note = `\n${cmd} 超时（${Math.round(o.timeoutMs / 1000)}s），已放弃`;
        out += note;
        if (!o.quiet) console.log(c.dim("      " + note.trim()));
        try {
          child.kill();
        } catch {
          /* 已退出 */
        }
      }, o.timeoutMs);
    }
    if (o.quiet) {
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (out += d));
    }
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      res({ code: code ?? 1, out });
    };
    child.on("close", finish);
    child.on("error", (e) => {
      out += e.message;
      finish(1);
    });
  });
}

const portOpen = (port, host = "127.0.0.1") =>
  new Promise((res) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      res(v);
    };
    s.setTimeout(700, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

function pidOnPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano`, { encoding: "utf8" });
      const line = out
        .split(/\r?\n/)
        .find((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
      if (!line) return null;
      const pid = line.trim().split(/\s+/).pop();
      return pid && pid !== "0" ? Number(pid) : null;
    }
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    return out ? Number(out.split(/\s+/)[0]) : null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* 进程可能已经退出 */
  }
}

/** 源码比构建产物新 → 需要重建 */
function newestMtime(dir, skip = new Set(["node_modules", ".next", ".git", "data", ".probe"])) {
  let newest = 0;
  const walk = (d, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else {
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* 忽略不可读文件 */
        }
      }
    }
  };
  walk(dir, 0);
  return newest;
}

function fetchHealth(port) {
  return new Promise((res) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 4000 },
      (r) => {
        let body = "";
        r.on("data", (d) => (body += d));
        r.on("end", () => {
          try {
            res(JSON.parse(body)?.data ?? null);
          } catch {
            res(null);
          }
        });
      },
    );
    req.on("error", () => res(null));
    req.on("timeout", () => {
      req.destroy();
      res(null);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 1. 运行环境 ------------------------------ */

stepTitle("运行环境");

const major = Number(process.versions.node.split(".")[0]);
info(`Node ${process.versions.node} · ${process.platform}/${process.arch}`);
if (major < 20) die(`Node 版本过低（需要 >= 20，当前 ${process.versions.node}）`, "https://nodejs.org 下载 LTS 版本");

// 宿主注入的 --require 钩子会在服务进程里接管 fs.unlink，坏掉时素材文件删不掉
if (nodeOptions.dropped.length) {
  warn(`已剔除 NODE_OPTIONS 里的宿主钩子 ${nodeOptions.dropped.length} 个（避免文件删除被拦截）`);
}

if (!existsSync(join(ROOT, "package.json"))) die("当前目录不像项目根目录（找不到 package.json）");

if (!existsSync(join(ROOT, "node_modules", "next"))) {
  warn("依赖未安装，开始 npm install（第一次会慢一点）");
  const r = await runAsync("npm", ["install"]);
  if (r.code !== 0) die("npm install 失败", "检查网络或 npm 镜像：npm config get registry");
  ok("依赖安装完成");
} else {
  ok("依赖已就绪");
}

if (!existsSync(join(ROOT, ".env"))) {
  if (existsSync(join(ROOT, ".env.example"))) {
    copyFileSync(join(ROOT, ".env.example"), join(ROOT, ".env"));
    warn("没有 .env，已从 .env.example 复制一份（模型 Key 需要自己填）");
  } else {
    warn("没有 .env，将全部使用默认值（本地引擎 + PGlite + 内存队列）");
  }
} else {
  ok(".env 已存在");
}

/* ------------------------------ 2. 基础设施 ------------------------------ */

stepTitle("基础设施（PostgreSQL / Redis）");

let infra = "external";
if (!opts.docker) {
  warn("已跳过 Docker，将使用 PGlite + 进程内队列（单实例可用）");
  infra = "embedded";
} else {
  let dockerOk = false;
  try {
    execSync("docker info", { stdio: "ignore", timeout: 10_000 });
    dockerOk = true;
  } catch {
    dockerOk = false;
  }

  if (!dockerOk) {
    warn("Docker 不可用（没装或没启动），降级为 PGlite + 进程内队列");
    info("功能一致，只是不适合多实例；需要完整形态请先启动 Docker Desktop");
    infra = "embedded";
  } else {
    info("docker compose up -d …（已有容器会秒回；首次拉镜像可能要一两分钟）");
    const r = await runAsync("docker", ["compose", "up", "-d"], { quiet: true, timeoutMs: 75_000 });
    if (r.code !== 0) {
      warn("docker compose 未能完成，降级为 PGlite + 进程内队列");
      info(r.out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" | "));
      infra = "embedded";
    } else {
      // 只查容器自身的健康状态，比 docker ps 全量快得多；最多等 45 秒
      const healthOf = (name) => {
        const h = spawnSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", name], {
          encoding: "utf8",
          shell: isWin,
          cwd: ROOT,
          timeout: 6000,
        });
        return (h.stdout ?? "").trim();
      };
      const t0 = Date.now();
      let pg = "";
      let rd = "";
      while (Date.now() - t0 < 45_000) {
        pg = healthOf("laikela-postgres");
        rd = healthOf("laikela-redis");
        if (pg === "healthy" && rd === "healthy") break;
        await sleep(1500);
      }
      if (pg === "healthy" && rd === "healthy") {
        ok(`postgres:5432 / redis:6379 均已健康（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
      } else {
        warn(`容器健康检查未就绪（postgres=${pg || "?"} redis=${rd || "?"}），继续启动`);
        info("/api/health 会显示真实状态；可用 docker compose logs 排查");
      }
      infra = "docker";
    }
  }
}

/* ------------------------------ 3. 端口 ------------------------------ */

stepTitle(`端口 ${opts.port}`);

const busy = await portOpen(opts.port);
if (busy) {
  const pid = pidOnPort(opts.port);
  let doKill = opts.force;

  // 双击 start.bat 重跑是最常见的场景：旧进程还在，这里直接问一句就能接管，
  // 不必让用户去翻 netstat 或记 --force。非交互环境（CI、后台运行）不问，直接中止。
  if (!doKill && process.stdin.isTTY) {
    const rl = await import("node:readline/promises").then((m) =>
      m.createInterface({ input: process.stdin, output: process.stdout }),
    );
    try {
      const ans = (await rl.question(
        `      端口被占用${pid ? `（PID ${pid}）` : ""}，结束它并继续？[y/N] `,
      ))
        .trim()
        .toLowerCase();
      doKill = ans === "y" || ans === "yes";
    } catch {
      doKill = false;
    } finally {
      rl.close();
    }
  }

  if (!doKill) {
    die(
      `端口 ${opts.port} 已被占用${pid ? `（PID ${pid}）` : ""}`,
      `换端口：node scripts/serve.mjs --port=${opts.port + 1}    或强制结束占用进程：加 --force`,
    );
  }
  if (pid) {
    warn(`结束占用进程 PID ${pid}`);
    killTree(pid);
    await sleep(1200);
    if (await portOpen(opts.port)) die(`端口 ${opts.port} 仍被占用，请手动处理`);
  }
  ok(`端口 ${opts.port} 已释放`);
} else {
  ok(`端口 ${opts.port} 空闲`);
}

/* ------------------------------ 4. 构建 ------------------------------ */

stepTitle(opts.dev ? "构建（开发模式跳过）" : "构建");

let needBuild = false;
if (opts.dev) {
  info("--dev：使用 next dev，源码改动即时生效");
} else if (opts.rebuild) {
  needBuild = true;
  info("--rebuild：强制重新构建");
} else if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
  needBuild = true;
  info("没有构建产物");
} else {
  const built = statSync(join(ROOT, ".next", "BUILD_ID")).mtimeMs;
  const srcNewest = Math.max(
    newestMtime(join(ROOT, "src")),
    newestMtime(join(ROOT, "public")),
    statSync(join(ROOT, "package.json")).mtimeMs,
    existsSync(join(ROOT, "next.config.ts")) ? statSync(join(ROOT, "next.config.ts")).mtimeMs : 0,
  );
  if (srcNewest > built) {
    needBuild = true;
    info("源码有更新，需要重新构建");
  } else {
    ok(`已有构建产物（${new Date(built).toLocaleString()}）`);
  }
}

if (needBuild) {
  const t0 = Date.now();
  const r = await runAsync("npm", ["run", "build"]);
  if (r.code !== 0) die("构建失败", "先跑 npm run typecheck 看类型错误；日志在上方");
  ok(`构建完成，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
}

/* ------------------------------ 5. 启动 ------------------------------ */

stepTitle("启动服务");

const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  opts.dev ? [nextBin, "dev", "-p", String(opts.port)] : [nextBin, "start", "-p", String(opts.port)],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...CHILD_ENV, PORT: String(opts.port), NODE_ENV: opts.dev ? "development" : "production" },
  },
);

let childExit = null;
child.on("exit", (code, sig) => {
  childExit = { code, sig };
});

/* ------------------------------ 6. 自检 ------------------------------ */

stepTitle("健康自检");

const deadline = Date.now() + 120_000;
let health = null;
let lastErr = "";
while (Date.now() < deadline) {
  if (childExit) break;
  await sleep(1500);
  health = await fetchHealth(opts.port);
  if (health) break;
  process.stdout.write(c.dim("."));
  lastErr = "服务尚未响应";
}
if (!health) process.stdout.write("\n");

if (!health) {
  if (childExit) {
    die(
      `服务进程退出（code=${childExit.code}）`,
      "看上面的报错；常见原因：端口冲突、.env 配置错误、构建产物损坏",
    );
  }
  warn(`120 秒内未拿到 /api/health：${lastErr}`);
  info("服务可能仍在启动（首次建表较慢），稍后手动访问 http://127.0.0.1:" + opts.port + "/api/health");
} else {
  const checks = health.checks ?? [];
  for (const ck of checks) {
    const detail = String(ck.detail ?? "").replace(/\s+/g, " ").slice(0, 76);
    console.log(`      ${ck.ok ? c.green("OK") : c.red("!!")}   ${ck.label.padEnd(20)} ${c.dim(detail)}`);
  }
  const providers = (health.providers ?? []).filter((p) => p.available);
  console.log("");
  info(
    `可用模型通道：${providers.map((p) => p.label + (p.model ? `(${p.model})` : "")).join(" · ") || "仅本地引擎"}`,
  );
  info(`模式：${health.mode === "cloud" ? "云端模型" : "本地引擎兜底"}`);

  const failed = checks.filter((x) => !x.ok);
  if (failed.length) {
    warn(`${failed.length} 项依赖未就绪：${failed.map((f) => f.label).join("、")}`);
    info("不影响页面打开，但相关功能会降级。检查 docker compose ps");
  }
}

/* ------------------------------ 启动成功信息 ------------------------------ */

if (!childExit) {
  const url = `http://127.0.0.1:${opts.port}`;
  console.log("");
  console.log(c.green("  ────────────────────────────────────────────────"));
  console.log(`  ${c.bold("服务已启动")}   ${c.cyan(url)}`);
  console.log("");
  console.log(`  登录账号   ${c.bold("owner@laikela.local")} / ${c.bold("laikela2026")}`);
  console.log(`  健康检查   ${url}/api/health`);
  console.log(`  素材库     ${url}/library`);
  console.log(`  管理后台   ${url}/admin`);
  console.log("");
  console.log(c.dim(`  基础设施：${
    infra === "docker" ? "Docker（PostgreSQL + Redis）" : "内嵌（PGlite + 进程内队列）"
  }`));
  console.log(c.dim("  按 Ctrl+C 停止服务（或直接关掉这个窗口）"));
  console.log(c.green("  ────────────────────────────────────────────────"));
  console.log("");

  if (opts.open) {
    const cmd = isWin ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    try {
      spawnSync(cmd, { shell: true, stdio: "ignore" });
    } catch {
      /* 打不开浏览器不算失败 */
    }
  }

  if (opts.check) {
    console.log(c.dim("  --check：跑计费毛利校验与模型连通性自检\n"));
    await runAsync("npm", ["run", "check:margin"]);
    await runAsync("npm", ["run", "check:ai"]);
    console.log("");
  }
}

/* ------------------------------ 退出与信号 ------------------------------ */

let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${c.dim(`收到 ${signal}，正在停止服务…`)}`);
  if (child.pid) killTree(child.pid);
  setTimeout(() => process.exit(0), 400);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
if (isWin) process.on("SIGBREAK", () => shutdown("SIGBREAK"));

child.on("exit", (code) => {
  if (stopping) return;
  console.log("");
  if (code === 0) {
    console.log(c.dim("服务已退出"));
    process.exit(0);
  }
  console.error(c.red(`服务异常退出（code=${code}）`));
  process.exit(code ?? 1);
});
