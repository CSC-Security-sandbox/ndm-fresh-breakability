import { Injectable, LoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { DefaultLogger, makeTelemetryFilterString, Runtime } from '@temporalio/worker';

@Injectable()
export class Logger implements LoggerService {
  static logLevel: string = process.env.LOG_LEVEL || 'info';
  static logDir: string = process.env.LOG_DIR || './logs';
  static workerId: string = process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29d';

  static logFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  });

  private loggerInstance: winston.Logger;
  private static isRuntimeInstalled = false;

  constructor() {
    if (!fs.existsSync(Logger.logDir)) {
      fs.mkdirSync(Logger.logDir);
    }

    this.loggerInstance = winston.createLogger({
      level: Logger.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        Logger.logFormat,
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
          filename: `${Logger.logDir}/${Logger.workerId}-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          zippedArchive: true,
          maxSize: '10m'
        }),
      ],
      exceptionHandlers: [
        new winston.transports.DailyRotateFile({
          filename: `${Logger.logDir}/${Logger.workerId}-%DATE%_exception.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          zippedArchive: true,
          maxSize: '10m'
        })
      ]
    });

    if (!Logger.isRuntimeInstalled) {
      Runtime.install({
        logger: new DefaultLogger('WARN', (entry) => {
          this.loggerInstance.log({
            label: entry.meta?.activityId
              ? 'activity'
              : entry.meta?.workflowId
              ? 'workflow'
              : 'worker',
            level: entry.level.toLowerCase(),
            message: entry.message,
            timestamp: Number(entry.timestampNanos / 1_000_000n),
            ...entry.meta,
          });
        }),
        telemetryOptions: {
          logging: {
            forward: {},
            filter: makeTelemetryFilterString({ core: 'WARN' }),
          },
        },
      });

      Logger.isRuntimeInstalled = true;  // Prevent future calls to Runtime.install()
    }
  }

  log(message: string) {
    this.loggerInstance.info(message);
  }

  info(message: string) {
    this.loggerInstance.info(message);
  }

  error(message: string) {
    this.loggerInstance.error(message);
  }

  warn(message: string) {
    this.loggerInstance.warn(message);
  }

  debug(message: string) {
    this.loggerInstance.debug(message);
  }

  verbose(message: string) {
    this.loggerInstance.verbose(message);
  }
}

export { LoggerService };