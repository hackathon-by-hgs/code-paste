import { Inject, Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { redactLogFields, scrubMessage, type LogValue } from '../common/redaction';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * The only sanctioned output path in the process (ESLint bans `console`).
 *
 * Every record passes through the allowlist redactor, so a field nobody thought about is dropped
 * rather than printed. `SECURITY.md` permits "device connected" and "payload rejected: too_large";
 * it forbids clipboard content, tokens and keys. The control plane never receives clipboard
 * content in the first place — this is the second line of defence, not the only one.
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly threshold: number;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.threshold = LEVEL_ORDER[this.config.logLevel];
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields: Record<string, unknown> = {}): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields: Record<string, unknown> = {}): void {
    this.write('error', message, fields);
  }

  /** Nest's LoggerService interface. */
  log(message: string): void {
    this.info(String(message));
  }
  verbose(message: string): void {
    this.debug(String(message));
  }

  /** Exposed for tests: builds the exact record that would be emitted, without emitting it. */
  buildRecord(level: LogLevel, message: string, fields: Record<string, unknown>): Record<string, LogValue> {
    return {
      timestamp: this.clock.now().toISOString(),
      level,
      message: scrubMessage(message),
      ...redactLogFields(fields),
    };
  }

  private write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.threshold) return;
    const record = this.buildRecord(level, message, fields);
    // Single structured line. process.stdout rather than console so the ESLint ban on `console`
    // stays absolute and this file is visibly the one exception.
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}
