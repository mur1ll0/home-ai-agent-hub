/**
 * Task Planning Domain
 * Inspired by ReAct (Reasoning + Acting) and HuggingGPT patterns
 * for multi-step task decomposition and orchestration
 */

export interface TaskSubtask {
  id: string;
  title: string;
  description: string;
  action: string; // e.g., 'web.search', 'web.extract', 'synthesize'
  inputs?: Record<string, unknown>;
  outputs?: string[]; // references to outputs from other subtasks
  priority: 'high' | 'medium' | 'low';
}

export interface TaskPlan {
  type: 'simple' | 'complex';
  originalRequest: string;
  reasoning: string;
  subtasks: TaskSubtask[];
  estimatedSteps: number;
  executionStrategy: 'sequential' | 'parallel'; // how to execute subtasks
}

export interface ContentGenerationContext {
  topic: string;
  mainTopics: string[];
  researchByTopic: Record<string, string>; // topic -> researched content
  structure: SlideStructure[];
}

export interface SlideStructure {
  slideNumber: number;
  title: string;
  bullets: string[];
  source?: string; // which research topic this came from
}

export interface TaskExecutionResult {
  subtaskId: string;
  status: 'completed' | 'failed' | 'skipped';
  output: unknown;
  durationMs: number;
  error?: string;
}
