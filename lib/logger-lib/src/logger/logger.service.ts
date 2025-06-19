import { Inject, Injectable, Scope } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { RequestContext } from '../middleware/request-context';

@Injectable({ scope: Scope.TRANSIENT }) 
export class LoggerService {
  private parentContext: string;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

  setParentContext(context: string) {
    this.parentContext = context;
  }

  log(message: string, trackId?: string, context?: string) {
    this.logger.log('info', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId: trackId ?? RequestContext.getTrackId(),
      message,
    });
  }

  error(message: string, trackId?: string, context?: string) {
    this.logger.log('error', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId: trackId ?? RequestContext.getTrackId(),
      message,
    });
  }

  debug(message: string, trackId?: string, context?: string) {
    this.logger.log('debug', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId: trackId ?? RequestContext.getTrackId(),
      message,
    });
  }

  warn(message: string, trackId?: string, context?: string) {
    this.logger.log('warn', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId: trackId ?? RequestContext.getTrackId(),
      message,
    });
  }
}
