import type { ComposedInstruction } from './skill-types.js';

export type SupportedAction =
  | 'file.read'
  | 'file.write'
  | 'file.move'
  | 'file.replace'
  | 'file.delete'
  | 'fs.list'
  | 'web.extract'
  | 'doc.create'
  | 'slide.create'
  | 'sheet.create'
  | 'mcp.connect'
  | 'image.generate'
  | 'video.generate'
  | 'model3d.generate'
  | 'chat.reply';

export interface AgentRequest {
  text: string;
  userId: string;
  sessionId: string;
  requestId?: string;
  workspaceRoot?: string;
  activeFilePath?: string;
  selectedModel?: string;
  onProgress?: (event: ProgressUpdate) => void;
}

export interface ProgressUpdate {
  stage: string;
  message: string;
  timestamp?: string;
  tokensTotal?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextWindowTokens?: number;
  contextUsedTokens?: number;
  contextUsedPercent?: number;
  configuredModel?: string;
  resolvedModel?: string;
}

export interface AgentResponse {
  language: string;
  summary: string;
  steps: string[];
  status?: 'completed' | 'pending_confirmation' | 'rejected';
  confirmationToken?: string;
  approvalDescription?: string;
  editedFiles?: EditedFileRecord[];
  executionReport?: ExecutionReport;
}

export type EditedFileStatus = 'pending' | 'kept' | 'reverted';

export interface EditedFileRecord {
  editId: string;
  filePath: string;
  backupPath?: string;
  isNewFile: boolean;
  status: EditedFileStatus;
  userId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolUsage {
  tool: string;
  action: SupportedAction;
  status: 'success' | 'failed' | 'skipped';
  durationMs?: number;
  details?: string;
}

export interface ModelUsage {
  provider: string;
  model: string;
  contextWindowTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextUsedTokens?: number;
  contextUsedPercent?: number;
  estimatedContextUsedTokens?: number;
  estimatedContextUsedPercent?: number;
}

export interface LlmInteraction {
  provider: 'openrouter' | 'ollama';
  configuredModel: string;
  resolvedModel?: string;
  operation: string;
  requestPrompt: string;
  responseText: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage?: ModelUsage;
  error?: string;
}

export interface RuntimeResources {
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryHeapTotalMb: number;
}

export interface RequestContextReport {
  workspaceRoot?: string;
  activeFilePath?: string;
}

export interface MemoryOperation {
  type: 'read' | 'write';
  key: string;
  valuePreview: string;
  timestamp: string;
}

export interface MemoryReport {
  backend: 'obsidian' | 'mempalace' | 'none';
  enabled: boolean;
  reads: MemoryOperation[];
  writes: MemoryOperation[];
}

export interface ExecutionStage {
  stage: string;
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
  details?: string;
}

export interface ExecutionReport {
  requestId: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  promptPreview: string;
  promptChars: number;
  intent?: ActionPlan;
  model: ModelUsage;
  resolvedModel?: string;
  llmInteractions: LlmInteraction[];
  tools: ToolUsage[];
  runtime: RuntimeResources;
  requestContext?: RequestContextReport;
  memory: MemoryReport;
  stages: ExecutionStage[];
  notes: string[];
  appliedSkill?: string;
  instructionVersion?: string;
}

export interface ActionPlan {
  action: SupportedAction;
  confidence: number;
  reason: string;
  isComplexTask?: boolean; // Indicates if task requires multi-step planning
  mainTopic?: string; // For complex tasks: the topic to research/analyze
  composedInstruction?: ComposedInstruction;
}

export interface ConfirmationTicket {
  token: string;
  request: AgentRequest;
  plan: ActionPlan;
  createdAt: string;
  expiresAt: string;
}

export function isDestructiveAction(action: SupportedAction): boolean {
  return action === 'file.delete' || action === 'file.move' || action === 'file.replace';
}
