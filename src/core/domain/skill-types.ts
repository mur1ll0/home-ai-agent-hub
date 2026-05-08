import type { SupportedAction } from './agent-types.js';

export type SkillId =
  | 'developer'
  | 'researcher'
  | 'planner'
  | 'analyst'
  | 'writer'
  | 'generalist';

export interface SkillProfile {
  id: SkillId;
  name: string;
  description: string;
  systemPrompt: string;
  compatibleActions: SupportedAction[];
  triggerPatterns: RegExp[];
  priority: number;
}

export interface ComposedInstruction {
  systemPrompt: string;
  appliedSkillId: SkillId;
  instructionVersion: string;
}
