import { Injectable, Inject, Scope } from '@nestjs/common';
import { LoggerService } from './logger.service';
import {RequestContext} from "../middleware/request-context";

@Injectable({ scope: Scope.TRANSIENT }) 
export class LoggerFactory {
  constructor(@Inject(LoggerService) private readonly loggerService: LoggerService,
              @Inject(RequestContext) private readonly requestContext: RequestContext) {}

  create(context: string): LoggerService {
    const loggerInstance = new LoggerService(this.loggerService['logger'], this.requestContext);
    loggerInstance.setParentContext(context);
    return loggerInstance;
  }
}
