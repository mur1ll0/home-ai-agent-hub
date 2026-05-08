import { createContainer } from './bootstrap/container.js';
import { loadAppEnv } from './infrastructure/config/env.js';
import { createHttpServer } from './interfaces/http/create-http-server.js';
import { runCli } from './interfaces/cli/cli.js';

async function bootstrap(): Promise<void> {
  const env = loadAppEnv();
  const container = await createContainer();

  if (env.APP_MODE === 'cli') {
    await runCli(container.handleUserRequestUseCase);
    return;
  }

  const app = await createHttpServer(
    container.handleUserRequestUseCase,
    env,
    container.mcpConnector,
    container.forkForModel.bind(container),
    container.fileEditSessionTool
  );
  await app.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT });

  if (env.APP_MODE === 'both') {
    await runCli(container.handleUserRequestUseCase);
  }
}

bootstrap().catch((error: unknown) => {
  console.error('[fatal]', error);
  process.exit(1);
});
