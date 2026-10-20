/**
 * 「这次到底发哪个模型名给供应商」—— 单一出口。
 *
 * 为什么要单独一个文件：
 *   目录（catalog.ts）被前端页面引用，不能读服务端 env（会被打成 undefined）；
 *   路由（router.ts）又拖了数据库依赖，脚本不想连库。
 *   于是把这条三行规则摘出来，谁都能引用，且不会出现「预览用 A 名字、实调用 B 名字」。
 *
 * 规则：目录里的 modelName 是出厂默认值；DeepSeek 文本主力档允许用 DEEPSEEK_MODEL 覆盖。
 * 覆盖值必须是供应商 GET /models 返回的 id，否则调用会 400 model_not_found ——
 * 改完跑 `npm run check:ai`，它会把「配置的名字」和「账号实际有的名字」对一遍。
 */
import { env } from "@/lib/env";
import type { ModelSpec } from "./catalog";

type SpecLike = Pick<ModelSpec, "provider" | "key" | "modelName">;

export function modelNameOf(spec: SpecLike): string {
  if (spec.provider === "deepseek" && spec.key === "deepseek-chat") {
    return env.providers.deepseek.model || spec.modelName;
  }
  if (spec.provider === "bailian" && spec.key === "bailian-text") {
    return env.providers.bailian.textModel || spec.modelName;
  }
  return spec.modelName;
}
