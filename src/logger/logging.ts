import * as fs from 'fs';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import {
  DefaultLogger,
  makeTelemetryFilterString,
  Runtime,
} from '@temporalio/worker';

class Logger {
  static logLevel: string = process.env.LOG_LEVEL || 'info';
  static logDir: string = process.env.LOG_DIR || './logs';
  static workerId: string =
    process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29d';

  static logFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  });

  static loggerInstance: winston.Logger = null;

  static getLogger(): winston.Logger {
    if (this.loggerInstance) {
      return this.loggerInstance;
    }

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir);
    }

    return winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        this.logFormat,
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
}

const logger = Logger.getLogger();
Runtime.install({
  logger: new DefaultLogger('WARN', (entry) => {
    logger.log({
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

export default Logger;
