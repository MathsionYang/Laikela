/** 文案结果的结构化模型：前端渲染、Tiptap 编辑、导出共用 */

export type Block =
  | { kind: "headline"; text: string }
  | { kind: "list"; title?: string; items: string[] }
  | { kind: "text"; title?: string; text: string }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "quote"; text: string };

export interface CopyOutput {
  blocks: Block[];
  plain: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 转成 Tiptap / ProseMirror 能直接吃的 HTML */
export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "headline":
          return `<h2>${esc(b.text)}</h2>`;
        case "text":
          return (b.title ? `<h3>${esc(b.title)}</h3>` : "") + `<p>${esc(b.text)}</p>`;
        case "list":
          return (
            (b.title ? `<h3>${esc(b.title)}</h3>` : "") +
            `<ul>${b.items.map((i) => `<li><p>${esc(i)}</p></li>`).join("")}</ul>`
          );
        case "quote":
          return `<blockquote><p>${esc(b.text)}</p></blockquote>`;
        case "table":
          return (
            (b.title ? `<h3>${esc(b.title)}</h3>` : "") +
            `<table><tbody>` +
            `<tr>${b.columns.map((c) => `<th><p>${esc(c)}</p></th>`).join("")}</tr>` +
            b.rows
              .map((r) => `<tr>${r.map((c) => `<td><p>${esc(c)}</p></td>`).join("")}</tr>`)
              .join("") +
            `</tbody></table>`
          );
      }
    })
    .join("\n");
}

export function blocksToPlain(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "headline":
          return b.text;
        case "text":
          return (b.title ? `【${b.title}】\n` : "") + b.text;
        case "list":
          return (b.title ? `【${b.title}】\n` : "") + b.items.map((i) => `· ${i}`).join("\n");
        case "quote":
          return `「${b.text}」`;
        case "table": {
          const head = b.columns.join(" | ");
          const body = b.rows.map((r) => r.join(" | ")).join("\n");
          return (b.title ? `【${b.title}】\n` : "") + head + "\n" + body;
        }
      }
    })
    .join("\n\n");
}

/** 宽松校验：模型（或本地引擎）返回的 JSON 是否像一份合格的文案结果 */
export function coerceBlocks(raw: unknown): Block[] | null {
  if (!raw || typeof raw !== "object") return null;
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const out: Block[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const item = b as Record<string, unknown>;
    switch (item.kind) {
      case "headline":
        if (typeof item.text === "string") out.push({ kind: "headline", text: item.text });
        break;
      case "quote":
        if (typeof item.text === "string") out.push({ kind: "quote", text: item.text });
        break;
      case "text":
        if (typeof item.text === "string")
          out.push({
            kind: "text",
            text: item.text,
            title: typeof item.title === "string" ? item.title : undefined,
          });
        break;
      case "list":
        if (Array.isArray(item.items))
          out.push({
            kind: "list",
            items: item.items.filter((x): x is string => typeof x === "string"),
            title: typeof item.title === "string" ? item.title : undefined,
          });
        break;
      case "table":
        if (Array.isArray(item.columns) && Array.isArray(item.rows))
          out.push({
            kind: "table",
            columns: (item.columns as unknown[]).filter((x): x is string => typeof x === "string"),
            rows: (item.rows as unknown[]).map((r) =>
              Array.isArray(r) ? r.map((c) => String(c)) : [],
            ),
            title: typeof item.title === "string" ? item.title : undefined,
          });
        break;
      default:
        break;
    }
  }
  return out.length ? out : null;
}
