import { Injectable, Inject, Scope } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Injectable({ scope: Scope.TRANSIENT }) 
export class LoggerFactory {
  constructor(@Inject(LoggerService) private readonly loggerService: LoggerService) {}

  create(context: string): LoggerService {
    const loggerInstance = new LoggerService(this.loggerService['logger']); 
    loggerInstance.setParentContext(context);
    return loggerInstance;
  }
}
