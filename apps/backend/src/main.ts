import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'node:fs';
import { AppModule } from './app.module';
import { LOCAL_STORAGE_URL_PREFIX } from './storage/local-disk-storage-driver';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // API.md: base path /api/v1/...
  app.setGlobalPrefix('api/v1');

  // Serves owner-uploaded salon photos back out when LocalDiskStorageDriver is the active photo
  // storage driver (see ObjectStorageService) — i.e. when LOCAL_STORAGE_DIR is set, which in
  // production points at a Railway persistent Volume mount. useStaticAssets registers plain
  // Express static middleware, not a Nest route, so it is served before and independently of the
  // JwtAuthGuard/RolesGuard chain below: salon photos are public content, same posture as the
  // existing @Public() discovery routes, and this mount needs no guard bypass because it was never
  // inside the guarded pipeline to begin with. A skipped mount (LOCAL_STORAGE_DIR unset — e.g. R2
  // is configured instead) simply means nothing is served at this prefix; the S3 driver's URLs
  // point at the object-storage provider directly and never touch this backend.
  const localStorageDir = process.env.LOCAL_STORAGE_DIR?.trim();
  if (localStorageDir) {
    // The directory is where SalonPhotosService's uploads land; created here too so a fresh
    // volume mount with nothing on it yet doesn't need a manual mkdir before the first upload.
    mkdirSync(localStorageDir, { recursive: true });
    app.useStaticAssets(localStorageDir, {
      prefix: `${LOCAL_STORAGE_URL_PREFIX}/`,
    });
  }

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
