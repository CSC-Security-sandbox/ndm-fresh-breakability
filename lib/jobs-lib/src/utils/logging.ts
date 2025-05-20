import * as fs from 'fs';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

export class Logger extends winston.Logger {
  static logLevel: string = process.env.LOG_LEVEL || 'info';
  static logDir: string = process.env.LOG_DIR || './logs';

  static logFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  });

  static loggerInstance: winston.Logger;

  static getLogger(context: string = 'jobs-lib'): winston.Logger {
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
          filename: `${this.logDir}/${context}-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
        }),
      ],
    });
  }
}
