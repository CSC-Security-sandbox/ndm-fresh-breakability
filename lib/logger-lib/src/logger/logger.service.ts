import { Inject, Injectable, Scope } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

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
      trackId,
      message,
    });
  }

  error(message: string, trackId?: string, context?: string) {
    this.logger.log('error', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId,
      message,
    });
  }

  debug(message: string, trackId?: string, context?: string) {
    this.logger.log('debug', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId,
      message,
    });
  }

  warn(message: string, trackId?: string, context?: string) {
    this.logger.log('warn', {
      context: context ?? this.parentContext ?? LoggerService.name,
      trackId,
      message,
    });
  }
}
