"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { apiPatch } from "@/lib/client/api";

/**
 * 文案结果编辑：Tiptap（ProseMirror）。
 * 结构化 blocks 已经转成语义化 HTML 灌进来，用户可以像文档一样改，
 * 保存时写回 copy_documents.content_html。
 */
export function CopyResult({
  jobId,
  html,
  plain,
  blocks,
}: {
  jobId: string;
  html: string;
  plain: string;
  blocks: unknown;
}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-body",
        spellcheck: "false",
      },
    },
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    if (editor && html && editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
      setDirty(false);
    }
    // 只在任务变化时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await apiPatch(`/api/jobs/${jobId}`, { docHtml: editor.getHTML() });
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    const text = editor?.getText() ?? plain;
    await navigator.clipboard.writeText(text).catch(() => {});
  };

  const download = (kind: "txt" | "md" | "json") => {
    const text = editor?.getText() ?? plain;
    const content =
      kind === "json"
        ? JSON.stringify({ blocks, plain: text }, null, 2)
        : kind === "md"
          ? toMarkdown(text)
          : text;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `来客啦-文案-${jobId.slice(-6)}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <Toolbar editor={editor} />

      <div
        className="card-2 min-h-[240px] px-4 py-3.5 lg:min-h-[320px]"
        style={{ background: "var(--surface)" }}
      >
        <EditorContent editor={editor} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={save} disabled={saving || !dirty}>
          <Icon name="check" size={13} />
          {saving ? "保存中…" : dirty ? "保存修改" : "已保存"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={copy}>
          <Icon name="copy" size={13} />
          复制全文
        </button>
        <div className="seg ml-auto">
          <button type="button" onClick={() => download("txt")}>
            TXT
          </button>
          <button type="button" onClick={() => download("md")}>
            MD
          </button>
          <button type="button" onClick={() => download("json")}>
            JSON
          </button>
        </div>
        {savedAt && (
          <span className="mono text-[10px]" style={{ color: "var(--t3)" }}>
            {savedAt} 已保存
          </span>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="skeleton h-9 w-full" />;

  const items = [
    { label: "B", title: "加粗", run: () => editor.chain().focus().toggleBold().run(), on: editor.isActive("bold"), strong: true },
    { label: "I", title: "斜体", run: () => editor.chain().focus().toggleItalic().run(), on: editor.isActive("italic"), italic: true },
    { label: "H2", title: "大标题", run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), on: editor.isActive("heading", { level: 2 }) },
    { label: "H3", title: "小标题", run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), on: editor.isActive("heading", { level: 3 }) },
    { label: "•", title: "无序列表", run: () => editor.chain().focus().toggleBulletList().run(), on: editor.isActive("bulletList") },
    { label: "1.", title: "有序列表", run: () => editor.chain().focus().toggleOrderedList().run(), on: editor.isActive("orderedList") },
    { label: "“", title: "引用", run: () => editor.chain().focus().toggleBlockquote().run(), on: editor.isActive("blockquote") },
  ];

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto rounded-[9px] border px-1.5 py-1"
      style={{ borderColor: "var(--line)", background: "var(--surface-in)" }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          title={it.title}
          aria-label={it.title}
          onClick={it.run}
          className="mono shrink-0 rounded-[6px] px-2 py-1.5 text-[11.5px] transition-colors"
          style={{
            background: it.on ? "var(--gold-soft)" : "transparent",
            color: it.on ? "var(--gold)" : "var(--t2)",
            fontWeight: it.strong ? 700 : 500,
            fontStyle: it.italic ? "italic" : undefined,
            minWidth: 30,
          }}
        >
          {it.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px shrink-0" style={{ background: "var(--line-2)" }} />
      <button
        type="button"
        title="撤销"
        onClick={() => editor.chain().focus().undo().run()}
        className="shrink-0 rounded-[6px] px-2 py-1.5"
        style={{ color: "var(--t3)" }}
      >
        <Icon name="refresh" size={14} />
      </button>
    </div>
  );
}

function toMarkdown(text: string) {
  return text
    .split("\n")
    .map((line) =>
      /^[一二三四五六七八九十]、|^\d+\./.test(line.trim()) ? `## ${line.trim()}` : line,
    )
    .join("\n\n");
}
