import { createApp } from './app';
import { securityFromEnvironment } from './security';
import { authFromEnvironment } from './auth/config';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

const app = await createApp(undefined, authFromEnvironment(), true, undefined, securityFromEnvironment());
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
