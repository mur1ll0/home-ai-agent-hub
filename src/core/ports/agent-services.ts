import type {
  ActionPlan,
  AgentRequest,
  AgentResponse,
  ConfirmationTicket,
  LlmInteraction,
  SupportedAction
} from '../domain/agent-types.js';
import type { ComposedInstruction, SkillId, SkillProfile } from '../domain/skill-types.js';

export interface IntentClassifier {
  classify(input: AgentRequest): Promise<ActionPlan>;
}

export interface SafetyGuard {
  validate(input: AgentRequest, plan: ActionPlan): Promise<void>;
}

export interface LanguageDetector {
  detectLanguage(text: string): Promise<string>;
}

export interface MemoryGateway {
  remember(userId: string, key: string, value: string): Promise<void>;
  recall(userId: string, key: string): Promise<string | null>;
  recallRecent(userId: string, limit?: number): Promise<Array<{ timestamp: string; key: string; value: string }>>;
}

export interface SkillRegistry {
  selectSkill(request: AgentRequest, plan: ActionPlan): SkillProfile;
  getSkill(id: SkillId): SkillProfile;
  listSkills(): SkillProfile[];
}

export interface InstructionComposer {
  compose(
    skill: SkillProfile,
    request: AgentRequest,
    options?: { memoryContext?: string }
  ): ComposedInstruction;
}

export interface ActionExecutor {
  execute(plan: ActionPlan, request: AgentRequest): Promise<AgentResponse>;
}

export interface ConfirmationManager {
  createTicket(request: AgentRequest, plan: ActionPlan): Promise<ConfirmationTicket>;
  consumeTicket(
    token: string,
    userId: string,
    sessionId: string
  ): Promise<ConfirmationTicket | null>;
  extractConfirmationToken(text: string): string | null;
}

export interface AuditEvent {
  timestamp: string;
  userId: string;
  sessionId: string;
  eventType:
    | 'request_received'
    | 'confirmation_requested'
    | 'confirmation_completed'
    | 'confirmation_invalid'
    | 'action_executed'
    | 'action_blocked';
  action?: SupportedAction;
  details?: string;
}

export interface AuditLogger {
  log(event: AuditEvent): Promise<void>;
}

export interface LlmTraceContext {
  runWithTrace<T>(traceId: string, operation: () => Promise<T>): Promise<T>;
  consumeTrace(traceId: string): LlmInteraction[];
  peekTrace(traceId: string): LlmInteraction[];
  attachTraceListener(traceId: string, listener: (interaction: LlmInteraction) => void): void;
  detachTraceListener(traceId: string): void;
}
