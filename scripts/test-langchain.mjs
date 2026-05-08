import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

async function main() {
  const model = new ChatOpenAI({
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    model: process.env.OPENROUTER_DEFAULT_MODEL ?? 'openrouter/auto',
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME ?? 'home-ai-agent-hub'
      }
    }
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'Responda em JSON com as chaves language e summary.'],
    ['human', 'Texto: {input}']
  ]);

  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()]);

  const output = await chain.invoke({
    input: 'Please summarize in one sentence why LangChain is useful for AI agents.'
  });

  console.log('LangChain chain output:\n');
  console.log(output);
}

main().catch((error) => {
  console.error('[test:langchain] failed:', error.message);
  process.exit(1);
});
