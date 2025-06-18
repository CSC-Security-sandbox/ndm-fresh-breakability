import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContext, RequestContextData } from '../request-context';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const traceId =
      (req.headers['traceid'] as string) ||
      (req.headers['x-trace-id'] as string) ||
      uuidv4();

    const context: RequestContextData = {
      traceId,
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
    };

    RequestContext.run(context, () => {
      next();
    });
  }
}