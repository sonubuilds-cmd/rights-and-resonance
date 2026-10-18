import type { HarnessInput, HarnessOutput } from './harness';
export const HARNESS_MINIMUM_VERSION: '0.1.26';
export function harnessArguments(endpoint: string, params: Record<string, string>): string[];
export function executeHarness(input: HarnessInput, fetchImpl?: typeof fetch): Promise<HarnessOutput>;
