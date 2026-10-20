import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "登录 · 来客啦" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await ensureDb();
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* 左：品牌叙事 */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 0%, #1d1712 0%, #0b0908 55%, #080605 100%)",
          borderRight: "1px solid var(--line)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "url('/assets/tools/image-poster.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center 30%",
            opacity: 0.18,
            filter: "grayscale(.35) blur(.5px)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(165deg, rgba(9,7,6,.82) 0%, rgba(9,7,6,.93) 52%, #080605 100%)",
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-[9px] text-[15px] font-semibold"
            style={{ background: "var(--gold)", color: "var(--on-gold)" }}
          >
            来
          </span>
          <div className="leading-tight">
            <div className="serif text-[16px]">来客啦</div>
            <div className="mono text-[9.5px] tracking-[.18em]" style={{ color: "var(--t3)" }}>
              AI CONTENT STUDIO
            </div>
          </div>
        </div>

        <div className="relative max-w-[520px]">
          <div className="eyebrow mb-3">AI CONTENT OPERATING SYSTEM</div>
          <h1 className="serif text-[34px] leading-[1.22] xl:text-[42px]">
            让每一条内容，
            <br />
            <span style={{ color: "var(--gold)" }}>都更接近爆款。</span>
          </h1>
          <p className="mt-5 max-w-[42ch] text-[13px] leading-[1.8]" style={{ color: "var(--t2)" }}>
            15 项能力覆盖文案、视觉、音频、视频与数字人。同一套任务、素材、审核与积分，
            把内容生产变成一条看得见的流水线。
          </p>

          <dl className="mt-9 grid grid-cols-3 gap-4">
            {[
              ["15", "项内容能力"],
              ["6", "类内容资产"],
              ["1", "条流水线"],
            ].map(([n, label]) => (
              <div key={label}>
                <dt className="mono text-[22px] leading-none" style={{ color: "var(--gold)" }}>
                  {n}
                </dt>
                <dd className="mt-1.5 text-[10.5px]" style={{ color: "var(--t3)" }}>
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative mono text-[10px]" style={{ color: "var(--t3)" }}>
          文案 · 图片 · 音频 · 视频 · 数字人 · 增长运营
        </p>
      </aside>

      {/* 右：表单 */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span
              className="grid h-8 w-8 place-items-center rounded-[8px] text-[14px] font-semibold"
              style={{ background: "var(--gold)", color: "var(--on-gold)" }}
            >
              来
            </span>
            <span className="serif text-[15px]">来客啦</span>
          </div>
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
