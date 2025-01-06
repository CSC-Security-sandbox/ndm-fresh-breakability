import { Injectable } from '@nestjs/common';
import { Logger } from 'winston';

@Injectable()
export class LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: string, trackId?: string, context?: string) {
    this.logger.log('info', {
        context: context ?? LoggerService.name,
        trackId,
        message,
    })
  }

  error(message: string, trackId?: string, context?: string) {
    this.logger.log('error', {
        context: context ?? LoggerService.name,
        trackId,
        message,
    })
  }

  debug(message: string, trackId?: string, context?: string) {
    this.logger.log('debug', {
        context: context ?? LoggerService.name,
        trackId,
        message,
    })
  }

  warn(message: string, trackId?: string, context?: string) {
    this.logger.log('warn', {
        context: context ?? LoggerService.name,
        trackId,
        message,
    })
  }


}