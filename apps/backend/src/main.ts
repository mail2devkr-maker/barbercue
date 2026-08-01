import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // API.md: base path /api/v1/...
  app.setGlobalPrefix('api/v1');

  // Web and mobile are separate origins in dev; tightened per-environment in a later phase.
  app.enableCors({ origin: true, credentials: true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(
    `@barbercue/backend listening on http://localhost:${port}/api/v1`,
  );
}
void bootstrap();
