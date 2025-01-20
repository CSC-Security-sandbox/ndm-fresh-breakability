import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import {
  DefaultLogger,
  makeTelemetryFilterString,
  Runtime,
} from '@temporalio/worker';

@Injectable()
export class LoggerService {
  private readonly logger: winston.Logger;
  private readonly logLevel: string = process.env.LOG_LEVEL || 'info';
  private readonly logDir: string = process.env.LOG_DIR || './logs';
  private readonly workerId: string =
    process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29d';

  constructor() {
    this.ensureLogDirectoryExists();
    this.logger = this.createWinstonLogger();
    this.setupTemporalRuntimeLogger();
  }

  private ensureLogDirectoryExists(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir);
    }
  }

  private createWinstonLogger(): winston.Logger {
    return winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        }),
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
          filename: `${this.logDir}/${this.workerId}-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
        }),
      ],
    });
  }

  private setupTemporalRuntimeLogger(): void {
    Runtime.install({
      logger: new DefaultLogger('WARN', (entry) => {
        this.logger.log({
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
  }

  log(level: string, message: string): void {
    this.logger.log(level, message);
  }

  info(message: string): void {
    this.logger.info(message);
  }

  warn(message: string): void {
    this.logger.warn(message);
  }

  error(message: string): void {
    this.logger.error(message);
  }
}

