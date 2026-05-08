import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { HandleUserRequestUseCase } from '../../core/use-cases/handle-user-request.use-case.js';

export async function runCli(useCase: HandleUserRequestUseCase): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log('Home AI Agent Hub iniciado. Digite sua solicitação (ou "exit").');

  try {
    while (true) {
      const text = await rl.question('> ');
      if (text.trim().toLowerCase() === 'exit') {
        break;
      }

      const response = await useCase.execute({
        text,
        userId: 'local-user',
        sessionId: 'local-session'
      });

      console.log(`Status: ${response.status ?? 'completed'}`);
      console.log(`Resumo: ${response.summary}`);
      response.steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
    }
  } finally {
    rl.close();
  }
}
