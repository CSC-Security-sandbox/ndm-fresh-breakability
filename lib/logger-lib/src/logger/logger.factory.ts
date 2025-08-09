import { Injectable, Inject, Scope } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { LoggerService } from './logger.service';
import { RequestContext } from "../middleware/request-context";
import { ConfigService } from '@nestjs/config';

@Injectable({ scope: Scope.TRANSIENT }) 
export class LoggerFactory {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
     readonly configService: ConfigService,
  ) {}

  create(context: string): LoggerService {
    const loggerInstance = new LoggerService(this.logger, this.requestContext, this.configService);
    loggerInstance.setParentContext(context);
    return loggerInstance;
  }
}
