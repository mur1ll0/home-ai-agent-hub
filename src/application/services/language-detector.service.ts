import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { LanguageDetector } from '../../core/ports/agent-services.js';
import type { LlmGateway } from '../../infrastructure/llm/openrouter-chat.gateway.js';

export class LanguageDetectorService implements LanguageDetector {
  constructor(private readonly llmGateway: LlmGateway) {}

  async detectLanguage(text: string): Promise<string> {
    if (/[áéíóúãõç]/i.test(text) || /(você|voce|obrigado|por favor)/i.test(text)) {
      return 'pt-BR';
    }

    if (/(hello|please|thanks|could you)/i.test(text)) {
      return 'en-US';
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        [
          'Classifique o idioma de resposta ideal para o usuário.',
          'Retorne APENAS um código BCP-47 curto, exemplo: pt-BR, en-US, es-ES.'
        ].join(' ')
      ],
      ['human', 'Texto: {text}']
    ]);

    const chain = RunnableSequence.from([
      prompt,
      RunnableLambda.from((value) =>
        this.llmGateway.ask(String(value), { operation: 'language_detection' })
      ),
      new StringOutputParser()
    ]);

    const raw = (await chain.invoke({ text })).trim();
    const match = raw.match(/[a-z]{2,3}-[A-Z]{2}/);
    if (match?.[0]) {
      return match[0];
    }

    return 'pt-BR';
  }
}
