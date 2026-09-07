import { Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { invalidRequest, type FieldError } from '../common/errors';

/**
 * Validates and *replaces* the incoming value with the parsed result.
 *
 * Two properties matter beyond "it checks types":
 *
 * 1. Every request schema is `.strict()`, so unknown properties are rejected rather than ignored.
 *    A silently-dropped unknown field is how mass-assignment bugs start.
 * 2. The parsed output is what reaches the controller, so a handler can never accidentally read an
 *    unvalidated property off the raw body.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        // One message per field. A field can fail several rules at once (an email that is both
        // malformed and fails a stricter pattern), and reporting each separately makes a client
        // render two errors against one input. First failure wins.
        const seen = new Set<string>();
        const details: FieldError[] = [];
        for (const issue of error.issues) {
          const path = issue.path.join('.') || '(body)';
          if (seen.has(path)) continue;
          seen.add(path);
          details.push({ path, message: issue.message });
          if (details.length === 32) break;
        }
        throw invalidRequest('Request validation failed.', details);
      }
      throw error;
    }
  }
}

export const zodBody = <T>(schema: ZodSchema<T>): ZodValidationPipe<T> => new ZodValidationPipe(schema);
