import { Inject, Injectable, Scope } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { RequestContext } from '../middleware/request-context';
import { ConfigService } from '@nestjs/config';
import { maskIPs } from './util/mask-sensitive';

@Injectable({ scope: Scope.TRANSIENT }) 
export class LoggerService {
  private parentContext: string;
  private readonly disableMasking: boolean;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
    private readonly configService: ConfigService,
  ) {
    this.disableMasking = this.configService.get<boolean>('loggerOptions.disableMasking') ?? false;
  }

  setParentContext(context: string) {
    this.parentContext = context;
  }

  log(message: string, data?: string | object) {
    this.logger.log('info', this.formatMessage(message, data));
  }

  error(message: string, data?: string | object) {
    this.logger.log('error', this.formatMessage(message, data));
  }

  debug(message: string, data?: string | object) {
    this.logger.log('debug', this.formatMessage(message, data));
  }

  warn(message: string, data?: string | object) {
    this.logger.log('warn', this.formatMessage(message, data));
  }

  private formatMessage(message: string, data?: string | object): object {
    const trackId =
        data && typeof data === 'object' && 'trackId' in data
            ? (data as any).trackId
            : this.requestContext.getTrackId();
    
    const projectId = this.requestContext.getProjectId();

    const baseLog = {
      message: message,
      context: this.parentContext ?? LoggerService.name,
      trackId: trackId,
      projectId: projectId
    };

    // Handle both string and object for data
    if (data !== undefined) {
      const maskedData = this.disableMasking ? data : maskIPs(data);
      return { ...baseLog, data: maskedData };
    }

    return baseLog;
  }
}
