import { Injectable, LoggerService } from '@nestjs/common';
import { WinstonLogger } from 'nest-winston';
import { createLogger, transports, format } from 'winston';
import 'winston-daily-rotate-file';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CustomLogger extends WinstonLogger implements LoggerService {
  constructor(private readonly configService: ConfigService) {
    const servicePath = configService.get<string>('loggerOptions.service', 'logs');

    const logger = createLogger({
      level: 'info', 
      format: format.combine(
        format.timestamp(),
        format.json(),
      ),
      transports: [
        new transports.DailyRotateFile({
          filename: `${servicePath}/%DATE%-error.log`,
          level: 'error',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxFiles: '30d',
        }),
        new transports.DailyRotateFile({
          filename: `${servicePath}/%DATE%-combined.log`,
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxFiles: '30d',
        }),
        new transports.Console({
          format: format.combine(
            format.cli(),
            format.splat(),
            format.timestamp(),
            format.printf(
              (info) => `${info.timestamp} ${info.level}: ${info.message}}`,
            ),
          ),
        }),
      ],
    });
    super(logger);
  }
}
