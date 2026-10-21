/** AI Gateway 的类型契约：所有供应商实现同一接口 */

export interface TextRequest {
  system: string;
  user: string;
  /** 要求返回 JSON */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  costCny: number;
}

export interface TextResult {
  text: string;
  provider: string;
  model: string;
  usage: UsageCost;
  latencyMs: number;
  /** 是否由本地规则引擎产出（未配置密钥时） */
  local: boolean;
  /** 上游 finish_reason。length = 写满 max_tokens 被截断，stop = 正常收尾 */
  finishReason?: string;
  /** 本次实际使用的输出上限，报错时用来告诉用户「卡在哪个数字上」 */
  maxTokens?: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  generateText(req: TextRequest): Promise<TextResult>;
}

export class ProviderError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
