import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class QueryTokenMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const token = req.query['token'] as string;
    const projectId = req.query['projectId'] as string;

    if (token && !req.headers['authorization']) {
      req.headers['authorization'] = `Bearer ${token}`;
    }
    if (projectId && !req.headers['projectid']) {
      req.headers['projectid'] = projectId;
    }

    next();
  }
}
