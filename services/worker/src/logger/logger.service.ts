import { Injectable, LoggerService } from '@nestjs/common';
import {
  DefaultLogger,
  makeTelemetryFilterString,
  Runtime,
} from '@temporalio/worker';
import * as fs from 'fs';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

import TransportStream = require('winston-transport');

import { FluentClient } from "@fluent-org/logger";

@Injectable()
export class Logger implements LoggerService {
  static logLevel: string = process.env.LOG_LEVEL || 'info';
  static logDir: string = process.env.LOG_DIR || './logs';
  static workerId: string =
    process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29d';

  static logFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  });

  private loggerInstance: winston.Logger;
  private static isRuntimeInstalled = false;
  public defaultLogger = new DefaultLogger('WARN', (entry) => {
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
  });

  constructor() {
    if (!fs.existsSync(Logger.logDir)) {
      fs.mkdirSync(Logger.logDir);
    }

    const fluentClient = new FluentClient("worker", {
      socket: {
        host: process.env.CONTROL_PLANE_IP || "192.168.64.189",
        port: process.env.FLUENT_PORT ? parseInt(process.env.FLUENT_PORT) : 32422,
        timeout: 3000,
      },
      security: {
        clientHostname: process.env.FLUENT_CLIENT_HOST || 'worker-client',
        sharedKey:
          process.env.FLUENT_SHARED_KEY || 'secure_communication_is_awesome',
      },
    });

    class FluentWinstonTransport extends TransportStream {
      log(info: any, callback: () => void) {
        fluentClient.emit("worker.log", info);
        callback();
      }
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
        new FluentWinstonTransport(),
        // new winston.transports.DailyRotateFile({
        //   filename: `${Logger.logDir}/${Logger.workerId}-%DATE%.log`,
        //   datePattern: 'YYYY-MM-DD',
        //   maxFiles: '14d',
        //   zippedArchive: true,
        //   maxSize: '10m'
        // }),
        // ],
        // exceptionHandlers: [
        //   new winston.transports.DailyRotateFile({
        //     filename: `${Logger.logDir}/${Logger.workerId}-%DATE%_exception.log`,
        //     datePattern: 'YYYY-MM-DD',
        //     maxFiles: '14d',
        //     zippedArchive: true,
        //     maxSize: '10m'
        //   })
      ],
    });

    if (!Logger.isRuntimeInstalled) {
      Runtime.install({
        logger: this.defaultLogger,
        telemetryOptions: {
          logging: {
            forward: {},
            filter: makeTelemetryFilterString({ core: 'WARN' }),
          },
        },
      });
      Logger.isRuntimeInstalled = true; // Prevent future calls to Runtime.install()
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
