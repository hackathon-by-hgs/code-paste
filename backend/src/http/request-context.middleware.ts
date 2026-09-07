import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newCorrelationId } from '../common/ids';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    startedAtMs?: number;
  }
}

/**
 * Assigns a correlation id to every request.
 *
 * The id is generated server-side and never taken from a client header: an attacker-controlled
 * correlation id would let someone poison or forge log entries. It is returned in `X-Request-Id`
 * and in error bodies so a user can quote it in a support request — it carries no user data
 * (`SPEC_CONTRACT.md` §11).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    req.requestId = newCorrelationId();
    req.startedAtMs = Date.now();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}
