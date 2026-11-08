export const MATCH_STATES = ['QUEUED', 'PROPOSED', 'READY', 'ACTIVE', 'SETTLING', 'SETTLED', 'VOID', 'FORFEIT'] as const;
export type MatchPhase = typeof MATCH_STATES[number];
const NEXT: Record<MatchPhase, readonly MatchPhase[]> = {
  QUEUED: ['PROPOSED', 'VOID'], PROPOSED: ['READY', 'VOID'], READY: ['ACTIVE', 'VOID'],
  ACTIVE: ['SETTLING', 'VOID'], SETTLING: ['SETTLED', 'FORFEIT'],
  SETTLED: [], VOID: [], FORFEIT: [],
};
export const terminalMatch = (state: MatchPhase) => NEXT[state].length === 0;
export function allowsMatchTransition(from: MatchPhase, to: MatchPhase) { return NEXT[from].includes(to); }
