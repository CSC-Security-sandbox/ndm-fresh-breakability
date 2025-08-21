import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {RequestContext, RequestContextData} from "./request-context";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContext) private readonly requestContext: RequestContext,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Extract trackId from headers or generate a new one
    const trackId = (req.get('trackId') as string) || uuidv4();
    const projectId = (req.get('projectId') as string);    
    const context: RequestContextData = { trackId: trackId, projectId: projectId };
    req['trackId'] = trackId;
    this.requestContext.run(context, () => next());
  }
}
