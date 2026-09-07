import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/configuration';
import { configureApp } from './http/configure-app';
import { LoggerService } from './observability/logger.service';
import { DatabaseService } from './persistence/database.service';

async function bootstrap(): Promise<void> {
  // `bufferLogs` so anything logged during startup goes through the redacting logger rather than
  // Nest's default console writer.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get(LoggerService);

  configureApp(app, config);

  // `req.ip` is only trustworthy behind a proxy we control; without this, a client could choose
  // its own rate-limit bucket by setting X-Forwarded-For.
  app.set('trust proxy', 1);

  const database = app.get(DatabaseService);
  const applied = await database.migrate();
  if (applied.length > 0) logger.info('migrations applied', { count: applied.length });

  await app.listen(config.port);
  logger.info('control plane started', { policy: config.env });
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet if configuration failed, so this is the one place a bare write is
  // unavoidable. The message is the validation summary, which names fields but never values.
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
