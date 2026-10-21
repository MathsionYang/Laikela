/**
 * 模型 JSON 容错解析的回归测试：npm run check:json
 *
 * 这些都是线上真实出现过的坏样本，不是编出来的：
 *   1. 10 条追爆脚本的 table 里，某一行用 `}` 闭合了数组；
 *   2. 输出写满 max_tokens 被截断，字符串/数组都没收尾；
 *   3. JSON 后面带一句「以上是文案，希望对你有帮助」；
 *   4. 模型压根没进 JSON，直接开始写「好的，以下是……」。
 *
 * 用一条样本把 json-repair 与 coerceBlocks 串起来验：能修则修，修不了必须返回 null
 * —— 宁可让上层重试，也不能把半份内容当成功交付。
 *
 * 加 --live 会真调一次模型（需要 .env 里有 Key），验线上链路。
 */
import "dotenv/config";
import { parseLooseJson } from "@/lib/ai/json-repair";
import { coerceBlocks } from "@/lib/domain/blocks";

interface Sample {
  name: string;
  raw: string;
  /** 期望：能否取出 blocks；null 表示应当判定为不可用 */
  blocks: number | null;
  /** 期望是否发生过修补 */
  repaired?: boolean;
}

/** 真实坏样本：rows 的最后一行用 } 收尾（应为 ]） */
const CLOSER_TYPO = `{"blocks":[{"kind":"headline","text":"开学第一课怎么接"},{"kind":"table","title":"发布窗口","columns":["时段","条数","编号","理由"],"rows":[["07:00-08:30","2 条","01、04","通勤时段，实用公式类完播高"],["11:30-13:30","2 条","02、07","午休泛娱乐 + 创作者自省内容"},["16:30-18:00","1 条","08","放学时段家长与学生同时在线"}],"plain":"【发布窗口】\\n07:00-08:30 两条"}`;

/** 真实坏样本：截断在正文中间，后面什么都没有 */
const TRUNCATED = `{"blocks":[{"kind":"headline","text":"春季限定燕麦拿铁"},{"kind":"list","title":"3 个标题","items":["0蔗糖也能喝出春天感","春天第一杯不用纠结","通勤路上顺手一杯"]},{"kind":"text","title":"正文","text":"春天上班最难的一件事：想喝点有季节感的东西，又不想一早就灌一杯甜`;

const SAMPLES: Sample[] = [
  {
    name: "正常 JSON",
    raw: `{"blocks":[{"kind":"headline","text":"一句话"}],"plain":"纯文本"}`,
    blocks: 1,
    repaired: false,
  },
  {
    name: "包在 ```json 代码块里",
    raw: '```json\n{"blocks":[{"kind":"text","text":"正文"}],"plain":"x"}\n```',
    blocks: 1,
    repaired: false,
  },
  { name: "rows 用 } 闭合（真实坏样本）", raw: CLOSER_TYPO, blocks: 2, repaired: true },
  { name: "输出被截断（真实坏样本）", raw: TRUNCATED, blocks: 2, repaired: true },
  {
    name: "JSON 后面跟了一句解释",
    raw: '{"blocks":[{"kind":"quote","text":"一句话"}],"plain":"x"}\n\n以上就是文案，希望对你有帮助！',
    blocks: 1,
    repaired: true,
  },
  {
    name: "完全不是 JSON",
    raw: "好的，以下是为你写的文案：\n\n标题：0 蔗糖也能喝出春天感\n\n正文：……",
    blocks: null,
  },
  {
    name: "结构合法但不是文案（blocks 为空）",
    raw: '{"blocks":[],"plain":""}',
    blocks: null,
  },
];

async function live(): Promise<number> {
  // 线上链路：这条输入当初就是 BAD_JSON 的现场（10 条表格最容易写崩）
  const { env } = await import("@/lib/env");
  const model = env.providers.deepseek.model;
  console.log(`\n[live] 用 ${model} 真跑一次「一键追爆 · 10 条」…`);
  const res = await fetch(`${env.providers.deepseek.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.providers.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            '你是热点跟进编辑。为「多巴胺穿搭」写 10 条抖音跟进脚本，每条含 3 秒钩子/主体/结尾动作/发布窗口。' +
            '只输出 JSON：{"blocks":[{"kind":"table","title":"脚本表","columns":["镜号","钩子","主体","结尾","窗口"],"rows":[["1","a","b","c","d"]]}],"plain":"摘要"}',
        },
        { role: "user", content: "平台：抖音；热度窗口：近 24 小时；输出 10 条。" },
      ],
      temperature: 0.7,
      max_tokens: env.ai.maxOutputTokens,
      response_format: { type: "json_object" },
    }),
  });
  const raw = await res.text();
  const j = JSON.parse(raw) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: { completion_tokens?: number };
  };
  const content = j.choices?.[0]?.message?.content ?? "";
  const finish = j.choices?.[0]?.finish_reason;
  const parsed = parseLooseJson(content);
  const blocks = parsed ? coerceBlocks(parsed.value) : null;
  console.log(
    `[live] finish=${finish} outTok=${j.usage?.completion_tokens} 解析=${parsed ? "OK" : "失败"}` +
      ` 修补=${parsed?.repaired ? parsed.note : "无"} blocks=${blocks?.length ?? 0}`,
  );
  return blocks ? 0 : 1;
}

async function main() {
  let failed = 0;
  for (const s of SAMPLES) {
    const parsed = parseLooseJson(s.raw);
    const blocks = parsed ? coerceBlocks(parsed.value) : null;
    const got = blocks ? blocks.length : null;

    const okCount = got === s.blocks || (s.blocks !== null && got !== null && got >= s.blocks);
    const okRepair = s.repaired === undefined || Boolean(parsed?.repaired) === s.repaired;
    const pass = okCount && okRepair;

    if (!pass) failed++;
    console.log(
      `${pass ? "✅" : "❌"} ${s.name}：blocks=${got ?? "null"}` +
        (parsed ? `，repaired=${parsed.repaired}${parsed.note ? `（${parsed.note}）` : ""}` : ""),
    );
  }

  if (process.argv.includes("--live")) failed += await live();

  console.log(failed ? `\n${failed} 项未通过` : "\n全部通过");
  process.exit(failed ? 1 : 0);
}

void main();
