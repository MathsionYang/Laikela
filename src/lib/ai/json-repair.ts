/**
 * 模型返回 JSON 的容错解析。
 *
 * 为什么不能直接 JSON.parse：`response_format: json_object` 只保证「看起来像 JSON」，
 * 并不保证语法合法。实测两类坏样本：
 *
 *   1. 被 max_tokens 截断 —— 字符串/数组/对象都没闭合，finish_reason=length；
 *   2. 闭合符写错 —— 多行表格里把某一行的 `]` 写成 `}`，finish_reason=stop。
 *
 * 这里只做「有明确证据的修补」：闭合符按栈纠正、截断后回退到最后一个完整元素再补齐。
 * 修完仍然解析不出来就返回 null —— 宁可让上层重试，也不要把半份内容当成成功。
 */

export interface LooseParseResult {
  value: unknown;
  /** 是否对原文做过修补（成功直读时为 false） */
  repaired: boolean;
  /** 修补说明，排障与日志用 */
  note: string | null;
}

const FENCE_HEAD = /^```(?:json)?\s*/i;
const FENCE_TAIL = /\s*```$/i;

export function stripJsonFence(s: string): string {
  return s.replace(FENCE_HEAD, "").replace(FENCE_TAIL, "").trim();
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function firstJsonStart(s: string): number {
  const obj = s.indexOf("{");
  const arr = s.indexOf("[");
  if (obj < 0) return arr;
  if (arr < 0) return obj;
  return Math.min(obj, arr);
}

interface ScanResult {
  /** 纠正闭合符之后的文本 */
  balanced: string;
  /** 扫描结束时仍开着的括号（按出现顺序，值为期望的闭合符） */
  openStack: string[];
  /** 结束时是否停在字符串内部（说明被截断） */
  inString: boolean;
  /** 字符串之外的每个逗号处的快照：位置 + 当时的括号栈 */
  snapshots: Array<{ index: number; stack: string[] }>;
  notes: string[];
}

/**
 * 单趟扫描：不构造 AST，只做括号配平与快照。
 *
 * 关闭符不匹配时按「栈顶期望」输出正确闭合符 —— 这是修 `]`/`}` 互写的关键，
 * 因为下游 coerceBlocks 会再校验一遍结构，修错了也进不去。
 */
function scan(src: string): ScanResult {
  const stack: string[] = [];
  const snapshots: Array<{ index: number; stack: string[] }> = [];
  const notes: string[] = [];
  let out = "";
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      started = true;
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (!started) continue; // 开头多余的闭合符直接丢掉
      /**
       * 关闭符对不上时有两种可能，都得兜住：
       *   a) 只是这一层写错（`]` 写成 `}`）→ 按栈顶补齐即可；
       *   b) 这一层写错、**同时**也要关掉外层（真实样本里表格行 `]` 写成 `}`，
       *      后面紧跟着才是 rows 的 `]`）。
       * 所以补齐一次之后拿原字符对着新的栈顶再试一遍，直到对上；
       * 无限链式不匹配就停下，交给 JSON.parse 判死。
       */
      let guard = 0;
      let closed = false;
      while (guard++ < 16) {
        const want = stack[stack.length - 1];
        if (!want) {
          notes.push(`丢弃多余闭合符 ${ch}`);
          closed = true;
          break;
        }
        if (want === ch) {
          stack.pop();
          out += ch;
          closed = true;
          break;
        }
        notes.push(`${ch} 应为 ${want}`);
        stack.pop();
        out += want;
        if (stack.length === 0) {
          // 补齐到顶层就算收口，原字符没有归属，丢掉
          closed = true;
          break;
        }
        // 还没收口：拿原字符对新栈顶再判一次
      }
      if (closed && stack.length === 0) break; // 顶层已闭合，后面的解释文字一律丢弃
      continue;
    }

    out += ch;
    if (ch === "," && stack.length) {
      // 记的是**逗号本身**的位置：截断时从这里切掉，末尾才不会留下一个
      // 悬空逗号（JSON 不允许尾逗号，补完括号也照样 parse 失败）。
      snapshots.push({ index: out.length - 1, stack: [...stack] });
    }
  }

  return { balanced: out, openStack: stack, inString, snapshots, notes };
}

/**
 * 宽松解析入口。
 *
 * 顺序：原样 → 纠正闭合符 → 从最后一个完整元素处截断并补齐。
 * 每一步都真的用 JSON.parse 验一次，假阳性不可能通过。
 */
export function parseLooseJson(raw: string): LooseParseResult | null {
  const text = stripJsonFence(raw);
  if (!text) return null;

  const direct = tryParse(text);
  if (direct !== undefined) return { value: direct, repaired: false, note: null };

  const start = firstJsonStart(text);
  if (start < 0) return null;

  const s = scan(text.slice(start));

  // 情况一：括号已配平，只是有闭合符写错
  if (!s.inString && s.openStack.length === 0) {
    const v = tryParse(s.balanced);
    if (v !== undefined) {
      return {
        value: v,
        repaired: true,
        note: s.notes.length ? `修正闭合符：${s.notes.slice(0, 3).join("；")}` : "移除 JSON 之外的附加文字",
      };
    }
  }

  // 情况二：被截断 —— 退回到最后一个逗号，丢掉写了一半的元素，再补齐剩余括号
  const tries = s.snapshots.slice(-3).reverse();
  for (const snap of tries) {
    const head = s.balanced.slice(0, snap.index);
    const tail = [...snap.stack].reverse().join("");
    const v = tryParse(head + tail);
    if (v !== undefined) {
      return {
        value: v,
        repaired: true,
        note: `输出被截断，已保留到最后一个完整元素（丢弃 ${s.balanced.length - snap.index} 字残片）`,
      };
    }
  }

  return null;
}
