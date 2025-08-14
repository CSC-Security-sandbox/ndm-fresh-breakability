import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {RequestContext, RequestContextData} from "./request-context";
import { LoggerService } from '../logger/logger.service';
import { LoggerFactory } from '../logger/logger.factory';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  readonly logger: LoggerService
  constructor(
    @Inject(RequestContext) private readonly requestContext: RequestContext,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create(RequestContextMiddleware.name);
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Extract trackId from headers or generate a new one
    const trackId =
        (req.get('trackId') as string) ||
        uuidv4();

    const projectId = (req.get('projectId') as string);    

    // Sanitize URL to remove sensitive query parameters
    const sanitizedUrl = req.url.split('?')[0];
    
    const context: RequestContextData = { trackId: trackId, projectId: projectId };
    req['trackId'] = trackId;

    this.requestContext.run(context, () => {
      this.logger.log(`Incoming request: [${req.method}] ${sanitizedUrl}`, {
        projectId,
      });

      res.on('finish', () => {
        const statusCode = res.statusCode;
        const logLevel = statusCode >= 400 ? 'error' : 'info';

        this.logger.log(logLevel, {
          projectId,
          message: `Response sent: [${req.method}] ${sanitizedUrl} - ${statusCode}`,
        });
      });

      next();
    });
  }
}
