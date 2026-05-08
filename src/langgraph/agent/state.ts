import { BaseMessage, BaseMessageLike } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { ActionPlan, AgentResponse } from '../../core/domain/agent-types.js';

export const AgentGraphState = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => []
  }),
  requestText: Annotation<string>({
    reducer: (_left: string, right: string) => right,
    default: () => ''
  }),
  plan: Annotation<ActionPlan | null>({
    reducer: (_left: ActionPlan | null, right: ActionPlan | null) => right,
    default: () => null
  }),
  language: Annotation<string>({
    reducer: (_left: string, right: string) => right,
    default: () => 'pt-BR'
  }),
  blockedReason: Annotation<string | null>({
    reducer: (_left: string | null, right: string | null) => right,
    default: () => null
  }),
  response: Annotation<AgentResponse | null>({
    reducer: (_left: AgentResponse | null, right: AgentResponse | null) => right,
    default: () => null
  })
});
