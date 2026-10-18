import { create } from 'zustand';
export type Surface = 'programme' | 'taste' | 'cohorts' | 'catalogue' | 'coverage' | 'repair' | 'evaluation' | 'agent';
export type Mode = 'DEMO' | 'QLOO' | 'METADATA' | 'LLM_ONLY';
type WorkstationStore = {
  surface: Surface; setSurface: (value: Surface) => void;
  mode: Mode; setMode: (value: Mode) => void; modeChosen: boolean; adoptDefaultMode: (value: Mode) => void;
  selectedVersionId: string | null; setSelectedVersionId: (value: string | null) => void;
  evidence: {filmId?: string; cohortId?: string; versionId?: string} | null;
  openEvidence: (value?: {filmId?: string; cohortId?: string; versionId?: string}) => void; closeEvidence: () => void;
  search: string; setSearch: (value: string) => void;
  toast: string | null; setToast: (value: string | null) => void;
};
export const useWorkstation = create<WorkstationStore>((set) => ({
  surface: 'programme', setSurface: surface => set({surface}), mode: 'DEMO', setMode: mode => set({mode, modeChosen: true}), modeChosen: false,
  adoptDefaultMode: mode => set(current => current.modeChosen ? current : {mode}),
  selectedVersionId: null, setSelectedVersionId: selectedVersionId => set({selectedVersionId}),
  evidence: null, openEvidence: (evidence = {}) => set({evidence}), closeEvidence: () => set({evidence: null}),
  search: '', setSearch: search => set({search}), toast: null, setToast: toast => set({toast}),
}));
