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
