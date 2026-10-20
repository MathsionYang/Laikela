"use client";

import { Icon } from "@/components/Icon";

const STEPS = [
  { key: "queued", label: "排队" },
  { key: "running", label: "生成" },
  { key: "post_processing", label: "后处理" },
  { key: "reviewing", label: "审核" },
  { key: "succeeded", label: "完成" },
];

export function JobProgress({
  status,
  stage,
  progress,
  onCancel,
}: {
  status: string;
  stage: string;
  progress: number;
  onCancel?: () => void;
}) {
  const activeIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.key === status),
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-7 w-7 items-center justify-center">
          <span
            className="absolute inset-0 animate-spin rounded-full"
            style={{
              border: "1.5px solid var(--line-2)",
              borderTopColor: "var(--gold)",
              animationDuration: "900ms",
            }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px]" style={{ color: "var(--t1)" }}>
            {stage}
          </div>
          <div className="mono text-[10.5px]" style={{ color: "var(--t3)" }}>
            {progress}% · {status}
          </div>
        </div>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <Icon name="close" size={12} />
            取消
          </button>
        )}
      </div>

      <div className="h-[3px] overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(3, progress)}%`, background: "var(--gold)" }}
        />
      </div>

      <ol className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done = i < activeIndex;
          const current = i === activeIndex;
          return (
            <li key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className="grid h-5 w-5 place-items-center rounded-full text-[9px]"
                style={{
                  background: done || current ? "var(--gold-soft)" : "var(--surface-2)",
                  color: done || current ? "var(--gold)" : "var(--t3)",
                  boxShadow: current ? "0 0 0 1px var(--gold-line)" : undefined,
                }}
              >
                {done ? <Icon name="check" size={11} /> : i + 1}
              </span>
              <span
                className="text-[10px]"
                style={{ color: current ? "var(--t1)" : "var(--t3)" }}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-center text-[10.5px]" style={{ color: "var(--t3)" }}>
        生成过程是异步的，可以切到别的页面，回来结果还在。
      </p>
    </div>
  );
}
