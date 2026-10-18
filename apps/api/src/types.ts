import type { Film, Cohort, ScreeningSlot as Slot, Constraints, AffinityMatrix, ProgrammeObjective } from '@rr/domain';

export type EvidenceMode = 'DEMO' | 'QLOO' | 'METADATA' | 'LLM_ONLY';
export type ProgrammeStatus = 'DRAFT' | 'APPROVED' | 'INVALIDATED' | 'SUPERSEDED';
export interface ProgrammeItem {
  slotId: string; filmId: string; filmTitle: string; startAt: string; endAt: string;
  runtimeMinutes: number; feePence: number; format: string; rightsSnapshot: Film['rights'];
}
export interface CohortCoverage { cohortId: string; cohortName: string; score: number }
export interface ProgrammeVersion {
  id: string; programmeId: string; version: number; parentVersionId?: string; createdAt: string;
  status: ProgrammeStatus; mode: EvidenceMode; items: ProgrammeItem[]; coverage: CohortCoverage[];
  objective: number; objectiveBreakdown: ProgrammeObjective; totalCost: number; explanation: string; evidenceId: string;
  approvedAt?: string; invalidatedAt?: string; invalidationReason?: string;
  inputRevision: number; repair?: { keptFilmIds: string[]; replacedFilmIds: string[]; objectiveDelta: number };
}
export interface ToolStep { node: string; startedAt: string; endedAt: string; status: 'OK' | 'ERROR'; detail: string }
export interface WorkflowRun {
  id: string; startedAt: string; endedAt?: string; mode: EvidenceMode; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  steps: ToolStep[]; versionId?: string; evidenceId?: string; error?: string; trigger: 'GENERATE' | 'REPAIR' | 'EVALUATE';
}
export interface EvidenceSnapshot {
  id: string; createdAt: string; mode: EvidenceMode; status: 'COMPLETE' | 'PARTIAL' | 'FAILED'; failureReason?: string; sourceLabel: string; synthetic: boolean;
  candidateFilmIds: string[]; excludedFilmIds: string[]; affinities: AffinityMatrix; normalizedAffinities: AffinityMatrix; inputRevision: number;
  inputs: { films: Film[]; cohorts: Cohort[]; slots: Slot[]; constraints: Constraints };
  providerResponses: unknown[]; warnings: string[]; claim: string;
  /** cohortId -> catalogue films that are seeds of that cohort: unscored by Qloo (unknown, never zero) and skipped for that cohort. */
  seedExcluded?: Record<string, string[]>;
}
export interface ProgrammeEvent {
  id: string; createdAt: string; type: string; payload: Record<string, unknown>;
  invalidatedVersionIds: string[]; repairedVersionId?: string; repairError?: string;
}
export interface EvaluationResult {
  id: string; createdAt: string; warning?: string; rows: Array<{ mode: EvidenceMode; status: 'SUCCEEDED' | 'UNAVAILABLE' | 'FAILED'; objective?: number; totalCost?: number; selectedFilmIds?: string[]; candidateFilmIds?: string[]; candidateCount?: number; evidenceId?: string; reason?: string }>;
}
export interface AppState {
  cinema: { id: string; name: string; timezone: string; currency: string };
  films: Film[]; cohorts: Cohort[]; slots: Slot[]; constraints: Constraints;
  versions: ProgrammeVersion[]; events: ProgrammeEvent[]; runs: WorkflowRun[];
  affinities: AffinityMatrix; evidenceMode: EvidenceMode;
  providerStatus: { qlooConfigured: boolean; llmConfigured: boolean; qlooVerifiedAt?: string; qlooVerifiedVia?: 'EVIDENCE' | 'TASTE'; persistence: 'memory' | 'postgres'; defaultMode?: EvidenceMode; qlooStatus: string; note: string };
  evidence: EvidenceSnapshot[]; evaluations: EvaluationResult[]; revision: number;
  mappings: Record<string, { entityId: string; confirmedAt: string; title: string }>;
}
