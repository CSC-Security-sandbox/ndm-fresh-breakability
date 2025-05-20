import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, 
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const trackId = uuidv4();
    req['trackId'] = trackId;

    this.logger.info({
      context: RequestLoggerMiddleware.name,
      trackId,
      message: `Incoming request: [${req.method}] ${req.url}`,
      ip: req.ip,
      headers: () => {
        const headers = { ...req.headers };
        delete headers['authorization'];
        return headers;
      }
    });

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const logLevel = statusCode >= 400 ? 'error' : 'info';

      this.logger.log(logLevel, {
        context: RequestLoggerMiddleware.name,
        trackId,
        message: `Response sent: [${req.method}] ${req.url} - ${statusCode}`,
      });
    });

    next();
  }
}
