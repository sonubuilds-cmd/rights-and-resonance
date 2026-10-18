/** Process-local record of the last successful, complete, non-stale live Qloo call. Never persisted: a restart is unverified again. */
let verified: { at: string; via: 'EVIDENCE' | 'TASTE' } | undefined;
export function markLiveVerified(via: 'EVIDENCE' | 'TASTE', now: () => Date = () => new Date()): void { verified = { at: now().toISOString(), via }; }
export function liveVerification() { return verified; }
export function resetLiveVerification(): void { verified = undefined; }
