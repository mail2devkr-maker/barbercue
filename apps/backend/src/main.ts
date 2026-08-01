import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // API.md: base path /api/v1/...
  app.setGlobalPrefix('api/v1');

  // Needed to read the httpOnly refresh-token cookie (web clients) — see AuthController.
  app.use(cookieParser());

  // Web and mobile are separate origins in dev; tightened per-environment in a later phase.
  // credentials:true is required for the browser to send/receive the httpOnly refresh cookie.
  app.enableCors({ origin: true, credentials: true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(
    `@barbercue/backend listening on http://localhost:${port}/api/v1`,
  );
}
void bootstrap();
