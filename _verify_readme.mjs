import fs from "node:fs";

const repo = "MathsionYang/Laikela";

const html = await (
  await fetch(`https://api.github.com/repos/${repo}/readme`, {
    headers: { Accept: "application/vnd.github.html+json", "User-Agent": "laikela-verify" },
  })
).text();

// GitHub 自己生成的锚点
const generated = new Set(
  [...html.matchAll(/<a[^>]*class="anchor"[^>]*href="([^"]+)"/g)].map((m) => m[1])
);

// README 里手写的目录链接
const md = fs.readFileSync("README.md", "utf8");
const toc = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => "#" + m[1]);

console.log(`GitHub 生成锚点: ${generated.size} 个`);
console.log(`README 目录链接: ${toc.length} 个\n`);

let bad = 0;
for (const t of toc) {
  const hit = generated.has(t);
  if (!hit) bad++;
  console.log(`${hit ? "OK  " : "DEAD"}  ${t}`);
}

// banner 是否被解析为图片
const banner = [...html.matchAll(/<img[^>]*src="([^"]*banner\.svg[^"]*)"/g)].map((m) => m[1]);
console.log(`\nbanner img 标签: ${banner.length ? banner[0] : "(未找到)"}`);

// 表格是否正常渲染
console.log(`渲染表格数: ${(html.match(/<table>/g) || []).length}`);
console.log(`渲染代码块数: ${(html.match(/<pre/g) || []).length}`);

console.log(`\n结果: ${bad === 0 ? "目录链接全部有效" : bad + " 个死链需修复"}`);
process.exitCode = bad === 0 ? 0 : 1;
