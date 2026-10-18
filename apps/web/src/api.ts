import type { TasteProfile } from '@rr/domain';
export type { TasteProfile, TasteTag } from '@rr/domain';
import type { AppState } from '../../api/src/types';
import type { QlooReadiness } from '@rr/qloo';
export type { QlooReadiness } from '@rr/qloo';
export type { AppState, ProgrammeVersion, EvidenceSnapshot, EvaluationResult } from '../../api/src/types';
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export class ApiError extends Error { constructor(message: string, public status: number, public details?: unknown) { super(message); this.name = 'ApiError'; } }
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    let data: {message?: string; error?: string; details?: unknown} = {};
    try { data = await response.json(); } catch { /* fallback for proxy and server errors */ }
    throw new ApiError(data.message ?? data.error ?? `The server returned ${response.status}. Please try again.`, response.status, data.details);
  }
  return response.json() as Promise<T>;
}
export const getState = (signal?: AbortSignal) => request<AppState>('/api/state', { signal });
/** This endpoint checks local setup only; it does not issue a provider request. */
export const getQlooReadiness = (signal?: AbortSignal) => request<QlooReadiness>('/api/qloo/readiness', { signal });
export const mutateState = (path: string, body: unknown = {}) => request<AppState>(path, {method: 'POST', body: JSON.stringify(body)});
export async function downloadExport(versionId: string, kind: 'export' | 'rights-enquiry') {
  const response = await fetch(`${baseUrl}/api/programme-versions/${encodeURIComponent(versionId)}/${kind}`, {credentials: 'include'});
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message ?? data.error ?? 'Export could not be prepared.'); }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition');
  const filename = disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `rights-resonance-${versionId}.${kind === 'export' ? 'json' : 'txt'}`;
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Taste DNA: why each recommendation fits. Source is labelled SYNTHETIC_DEMO unless live Qloo is wired. */
export const getTaste = (signal?: AbortSignal) => request<TasteProfile>('/api/taste', { signal });

// ---------- Programming Agent (Gemini function calling over the shared tool registry) ----------
export type AgentProvenance = 'QLOO_LIVE' | 'DEMO';
export interface AgentStep { id: string; tool: string; args: Record<string, unknown>; ok: boolean; summary: string; code?: string; provenance?: AgentProvenance; requiresConfirmation?: boolean; mutated?: boolean; confirmedByUser?: boolean; ms: number }
export interface AgentPending { versionId: string; summary: string }
export interface AgentMessage { id: string; role: 'user' | 'assistant'; text: string; steps?: AgentStep[]; at: string; error?: boolean }
export interface AgentStatus { available: boolean; model: string; scripted: boolean; reason?: string; limits?: { perMinute: number; perDay: number; maxMessageChars: number } }
export interface AgentResult { reply: string; steps: AgentStep[]; pendingApproval: AgentPending | null; model: string; scripted: boolean; rounds: number }
export type AgentStreamEvent =
  | { type: 'thinking'; round: number }
  | { type: 'step_start'; id: string; tool: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'done'; result: AgentResult }
  | { type: 'error'; status: number; error: string; message: string; steps?: AgentStep[]; pendingApproval?: AgentPending | null };
export class AgentChatError extends Error { constructor(message: string, public code: string, public steps: AgentStep[] = [], public pendingApproval: AgentPending | null = null) { super(message); this.name = 'AgentChatError'; } }
export const getAgentStatus = (signal?: AbortSignal) => request<AgentStatus>('/api/agent/status', { signal });
export const getAgentConversation = (signal?: AbortSignal) => request<{ messages: AgentMessage[]; pendingApproval: AgentPending | null }>('/api/agent/conversation', { signal });
export const resetAgentConversation = () => request<{ ok: true }>('/api/agent/conversation', { method: 'DELETE' });
/** POST /api/agent/chat as NDJSON so the UI can show each tool call as it happens. Resolves with the final result. */
export async function streamAgentChat(body: { message: string } | { confirmApproval: string }, onEvent: (event: AgentStreamEvent) => void, signal?: AbortSignal): Promise<AgentResult> {
  const response = await fetch(`${baseUrl}/api/agent/chat`, { method: 'POST', credentials: 'include', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) {
    let data: { message?: string; error?: string; steps?: AgentStep[]; pendingApproval?: AgentPending | null } = {};
    try { data = await response.json(); } catch { /* proxy error page */ }
    throw new AgentChatError(data.message ?? `The server returned ${response.status}. Please try again.`, data.error ?? 'REQUEST_FAILED', data.steps, data.pendingApproval ?? null);
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result: AgentResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AgentStreamEvent;
    if (event.type === 'error') throw new AgentChatError(event.message, event.error, event.steps, event.pendingApproval ?? null);
    if (event.type === 'done') result = event.result;
    onEvent(event);
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    lines.forEach(handle);
    if (done) break;
  }
  handle(buffer);
  if (!result) throw new AgentChatError('The connection ended before the agent finished. Please try again.', 'STREAM_ENDED');
  return result;
}
