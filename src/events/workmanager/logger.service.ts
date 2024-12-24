import { Logger, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileLogger extends Logger {
  private logFile = path.join(__dirname, '..', 'logs', 'application.log');

  constructor(context?: string) {
    super(context);
    // Ensure the log directory exists
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
  }

  log(message: string) {
    super.log(message);
    this.writeToFile(`[LOG] ${message}`);
  }

  error(message: string, trace?: string) {
    super.error(message, trace);
    this.writeToFile(`[ERROR] ${message}\nTrace: ${trace}`);
  }

  warn(message: string) {
    super.warn(message);
    this.writeToFile(`[WARN] ${message}`);
  }

  private writeToFile(message: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.logFile, `${timestamp} - ${message}\n`);
  }
}
