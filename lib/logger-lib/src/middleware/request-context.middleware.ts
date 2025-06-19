import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { v4 as uuidv4 } from 'uuid';
import {RequestContext, RequestContextData} from "./request-context";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, 
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Extract trackId from headers or generate a new one
    const trackId =
        (req.get('trackId') as string) ||
        uuidv4();

    const context: RequestContextData = { trackId: trackId };
    req['trackId'] = trackId;

    RequestContext.run(context, () => {
      this.logger.info({
        context: RequestContextMiddleware.name,
        trackId,
        message: `Incoming request: [${req.method}] ${req.url}`,
        ip: req.ip,
        headers: (() => {
          const headers = { ...req.headers };
          delete headers['authorization'];
          return headers;
        })(),
      });

      res.on('finish', () => {
        const statusCode = res.statusCode;
        const logLevel = statusCode >= 400 ? 'error' : 'info';

        this.logger.log(logLevel, {
          context: RequestContextMiddleware.name,
          trackId,
          message: `Response sent: [${req.method}] ${req.url} - ${statusCode}`,
        });
      });

      next();
    });
  }
}
