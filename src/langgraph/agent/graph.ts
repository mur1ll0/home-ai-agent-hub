import { StateGraph } from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';
import { createContainer } from '../../bootstrap/container.js';
import { AgentGraphState } from './state.js';

const app = await createContainer();

const extractInputNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  const last = state.messages[state.messages.length - 1];
  const content =
    typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? '' : '';

  return {
    requestText: content.trim()
  };
};

const classifyIntentNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  const result = await app.intentClassifier.classify({
    text: state.requestText,
    userId: 'langgraph-user',
    sessionId: 'langgraph-session'
  });

  return {
    plan: result
  };
};

const detectLanguageNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  const language = await app.languageDetector.detectLanguage(state.requestText);

  return {
    language
  };
};

const safetyCheckNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  if (!state.plan) {
    return {
      blockedReason: 'Plano de ação ausente.'
    };
  }

  try {
    await app.safetyGuard.validate(
      {
        text: state.requestText,
        userId: 'langgraph-user',
        sessionId: 'langgraph-session'
      },
      state.plan
    );

    return {
      blockedReason: null
    };
  } catch (error) {
    return {
      blockedReason: error instanceof Error ? error.message : String(error)
    };
  }
};

const executeNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  const response = await app.handleUserRequestUseCase.execute({
    text: state.requestText,
    userId: 'langgraph-user',
    sessionId: 'langgraph-session'
  });

  return {
    response,
    messages: [
      new AIMessage({
        content: [
          `status: ${response.status ?? 'completed'}`,
          `language: ${response.language}`,
          `summary: ${response.summary}`,
          `steps: ${response.steps.join(' | ')}`,
          response.confirmationToken ? `confirmationToken: ${response.confirmationToken}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      })
    ]
  };
};

const blockedNode = async (
  state: typeof AgentGraphState.State
): Promise<typeof AgentGraphState.Update> => {
  return {
    response: {
      language: state.language,
      status: 'rejected',
      summary: state.blockedReason ?? 'Solicitação bloqueada pela política de segurança.',
      steps: ['Ajuste a solicitação para um caminho permitido e tente novamente.']
    },
    messages: [
      new AIMessage({
        content: `status: rejected\nsummary: ${state.blockedReason ?? 'Bloqueado pela política.'}`
      })
    ]
  };
};

const routeAfterSafety = (state: typeof AgentGraphState.State): 'blocked' | 'execute' => {
  return state.blockedReason ? 'blocked' : 'execute';
};

const graphBuilder = new StateGraph(AgentGraphState)
  .addNode('extract_input', extractInputNode)
  .addNode('classify_intent', classifyIntentNode)
  .addNode('detect_language', detectLanguageNode)
  .addNode('safety_check', safetyCheckNode)
  .addNode('execute', executeNode)
  .addNode('blocked', blockedNode)
  .addEdge('__start__', 'extract_input')
  .addEdge('extract_input', 'classify_intent')
  .addEdge('classify_intent', 'detect_language')
  .addEdge('detect_language', 'safety_check')
  .addConditionalEdges('safety_check', routeAfterSafety)
  .addEdge('execute', '__end__')
  .addEdge('blocked', '__end__');

export const graph = graphBuilder.compile();
graph.name = 'Home AI Agent Decision Graph';
