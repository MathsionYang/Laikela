"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ToolDef, SectionDef } from "@/lib/domain/tools";

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; detail?: unknown };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || !body.ok) {
    throw new ApiError(
      body.error?.code ?? `HTTP_${res.status}`,
      body.error?.message ?? "请求失败",
      body.error?.detail,
    );
  }
  return body.data as T;
}

export class ApiError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export const apiGet = <T,>(url: string) => request<T>(url);
export const apiPost = <T,>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const apiPatch = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "PATCH", body: JSON.stringify(body) });

export interface ToolWithStats extends ToolDef {
  enabled: boolean;
  runs: number;
  lastRunAt: string | null;
}

export interface ToolsPayload {
  sections: SectionDef[];
  tools: ToolWithStats[];
}

export interface ClientJob {
  id: string;
  tool: string;
  status: string;
  stage: string;
  progress: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  error: { code: string; message: string } | null;
  cost: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ClientAsset {
  id: string;
  kind: string;
  role: string;
  name: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardPayload {
  metrics: {
    monthRuns: number;
    todayRuns: number;
    running: number;
    successRate: number;
    passRate: number;
    remaining: number;
    quota: number;
    monthCost: number;
  };
  daily: Array<{ day: string; runs: number; cost: number }>;
  recent: ClientJob[];
  trends: Array<{
    platform: string;
    keyword: string;
    heat: number;
    growth: number;
    capturedAt: string;
  }>;
}

export interface UsagePayload {
  monthCredits: number;
  monthCost: number;
  quota: number;
  remaining: number;
  byProvider: Array<{ provider: string; cost: number; count: number }>;
  byTool: Array<{ tool: string; runs: number; cost: number }>;
  daily: Array<{ day: string; runs: number; cost: number }>;
}

export interface HealthPayload {
  app: { name: string; sub: string };
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
  providers: Array<{ id: string; label: string; available: boolean; local?: boolean }>;
  mode: "cloud" | "local";
}

export const useTools = () =>
  useQuery({ queryKey: ["tools"], queryFn: () => apiGet<ToolsPayload>("/api/tools") });

export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
    refetchInterval: 8_000,
  });

export const useUsage = () =>
  useQuery({ queryKey: ["usage"], queryFn: () => apiGet<UsagePayload>("/api/usage") });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => apiGet<HealthPayload>("/api/health") });

export const useJob = (id: string | null) =>
  useQuery({
    queryKey: ["job", id],
    queryFn: () => apiGet<{ job: ClientJob; assets: ClientAsset[] }>(`/api/jobs/${id}`),
    enabled: Boolean(id),
    // 未到终态时持续轮询（SSE 之外的第二重保险）
    refetchInterval: (q) => {
      const s = q.state.data?.job.status;
      return s && ["succeeded", "failed", "canceled"].includes(s) ? false : 1200;
    },
  });

export const useJobList = (opts: { tool?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.tool) params.set("tool", opts.tool);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ["jobs", opts.tool ?? "all", opts.limit ?? 20],
    queryFn: () => apiGet<ClientJob[]>(`/api/jobs${qs ? `?${qs}` : ""}`),
  });
};

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { tool: string; input: Record<string, unknown>; modelKey?: string | null }) =>
      apiPost<ClientJob>("/api/jobs", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<{ canceled: boolean }>(`/api/jobs/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job"] });
    },
  });
}

export async function uploadAssets(files: File[]): Promise<ClientAsset[]> {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  return request<ClientAsset[]>("/api/assets", { method: "POST", body: form });
}

export const useAssets = (kind?: string) =>
  useQuery({
    queryKey: ["assets", kind ?? "all"],
    queryFn: () => apiGet<ClientAsset[]>(`/api/assets?limit=60${kind ? `&kind=${kind}` : ""}`),
  });

/* ------------------------------ 账号 / 订阅 / 积分 ------------------------------ */

export interface MePayload {
  user: {
    id: string;
    orgId: string;
    email: string;
    name: string;
    role: string;
    avatarHue: number;
  } | null;
  org?: { id: string; name: string; plan: string };
  plan?: PlanPayload | null;
  subscription?: SubscriptionPayload | null;
  credits?: CreditSummary;
}

export interface PlanPayload {
  code: string;
  name: string;
  tagline: string;
  priceCny: number;
  monthlyCredits: number;
  seats: number;
  features: string[];
  sort: number;
}

export interface SubscriptionPayload {
  id: string;
  planCode: string;
  status: string;
  seats: number;
  priceCny: number;
  periodStart: string;
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  autoRenew: boolean;
  orderNo: string | null;
}

export interface CreditSummary {
  balance: number;
  grantedThisMonth: number;
  consumedThisMonth: number;
  refundedThisMonth: number;
}

export interface LedgerEntry {
  id: string;
  job_id: string | null;
  kind: "grant" | "consume" | "refund" | "expire" | "adjust";
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
}

export interface BillingPayload {
  plan: PlanPayload | null;
  subscription: SubscriptionPayload | null;
  credits: CreditSummary;
  ledger: LedgerEntry[];
  plans: PlanPayload[];
}

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: () => apiGet<MePayload>("/api/auth/me") });

export const useBilling = () =>
  useQuery({ queryKey: ["billing"], queryFn: () => apiGet<BillingPayload>("/api/billing") });

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { planCode: string; months?: number }) =>
      apiPost<{ plan: PlanPayload; grantedCredits: number; orderNo: string }>("/api/billing", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billing"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useToggleRenew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "cancel" | "resume") =>
      apiPatch<{ subscription: SubscriptionPayload | null }>("/api/billing", { action }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billing"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export async function logout(): Promise<void> {
  await apiPost("/api/auth/logout");
}

/* ------------------------------ 模型与 Key ------------------------------ */

export type ModelKindView = "text" | "image" | "video" | "audio";

export interface ModelPayload {
  key: string;
  provider: "deepseek" | "doubao" | "local";
  vendor: string;
  label: string;
  kind: ModelKindView;
  protocol: string;
  modelName: string;
  contextK: number | null;
  unit: string;
  unitPrice: number;
  credits: number;
  requiresPlan: string;
  capabilities: string[];
  byokOnly: boolean;
  fallback: string | null;
  note: string;
  enabled: boolean;
  available: boolean;
  keySource: "byok" | "platform" | "none";
  allowedByPlan: boolean;
  usable: boolean;
  reason: string | null;
}

export interface CredentialPayload {
  provider: "deepseek" | "doubao";
  configured: boolean;
  label: string | null;
  keyHint: string | null;
  status: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface EndpointPayload {
  id: string;
  name: string;
  kind: "text" | "image";
  protocol: string;
  baseUrl: string;
  modelName: string;
  contextK: number | null;
  credits: number;
  keyHint: string;
  enabled: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  modelKey: string;
}

export interface TestResultPayload {
  ok: boolean;
  latencyMs: number;
  endpoint: string;
  model: string;
  sample?: string;
  error?: string;
  hint?: string | null;
}

export interface ModelsPayload {
  planCode: string;
  planRank: number;
  canManageKeys: boolean;
  models: ModelPayload[];
  credentials: CredentialPayload[];
  endpoints: EndpointPayload[];
}

export const useModels = () =>
  useQuery({
    queryKey: ["models"],
    queryFn: () => apiGet<ModelsPayload>("/api/models"),
    staleTime: 30_000,
  });

export function useSaveKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: "deepseek" | "doubao"; apiKey: string; label?: string }) =>
      apiPost<{ credential: CredentialPayload }>("/api/models/keys", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useDeleteKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: "deepseek" | "doubao") =>
      request<{ credentials: CredentialPayload[] }>(`/api/models/keys?provider=${provider}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

/** 运行时启停某个模型（只改库里的开关，不动目录） */
export function useToggleModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; enabled: boolean }) =>
      apiPatch<{ key: string; enabled: boolean }>("/api/models", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

/* --------------------------- 自定义端点（OpenAI 兼容） --------------------------- */

export function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      name: string;
      kind: "text" | "image";
      baseUrl: string;
      modelName: string;
      apiKey: string;
      contextK?: number | null;
      credits?: number;
    }) => apiPost<{ endpoint: EndpointPayload }>("/api/models/endpoints", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useToggleEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      apiPatch<{ endpoints: EndpointPayload[] }>("/api/models/endpoints", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ endpoints: EndpointPayload[] }>(`/api/models/endpoints?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useTestEndpoint() {
  return useMutation({
    mutationFn: (vars: { id?: string; baseUrl?: string; modelName?: string; apiKey?: string }) =>
      apiPost<TestResultPayload>("/api/models/endpoints/test", vars),
  });
}
