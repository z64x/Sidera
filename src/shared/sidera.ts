export const SIDERA_AGENT_ID = 'sidera';
export const SIDERA_AGENT_NAME = 'Sidera';

export function isSideraScope(scope?: string | null): boolean {
  return scope === SIDERA_AGENT_ID || scope === 'auto';
}
