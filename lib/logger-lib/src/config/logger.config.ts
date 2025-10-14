import { registerAs } from "@nestjs/config";
import { LoggerOptions } from "./logger.type";

/**
 * Logger configuration
 * 
 * Environment Variables:
 * - LOG_DIR: Directory path for log files (default: './logs')
 * - LOG_LEVEL: Minimum log level ('error', 'warn', 'info', 'debug', default: 'info')
 * - NODE_ENV: Application environment ('test', 'development', 'production')
 * - ENABLE_FILE_LOGGING: Enable/disable file logging ('true'/'false', default: 'true')
 * - ENABLE_CONSOLE_LOGGING: Enable/disable console logging ('true'/'false', default: 'true')
 * - LOG_MAX_FILES: Maximum number of log files to keep (default: '30d')
 * - LOG_MAX_SIZE: Maximum size per log file (default: '20m')
 * - LOG_DATE_PATTERN: Date pattern for log rotation (default: 'YYYY-MM-DD')
 * - LOG_ZIPPED_ARCHIVE: Compress old log files ('true'/'false', default: 'true')
 * 
 * File logging is disabled when:
 * - NODE_ENV is 'test' 
 * - ENABLE_FILE_LOGGING is 'false'
 */
export default registerAs('loggerOptions', (): LoggerOptions => ({
    logsDir: process.env.LOG_DIR?.toLowerCase() || './logs',
    logLevel: process.env.LOG_LEVEL?.toLowerCase() || 'debug',  // Changed from 'info' to 'debug'
    enableFileLogging: process.env.ENABLE_FILE_LOGGING?.toLowerCase() !== 'false',
    enableConsoleLogging: process.env.ENABLE_CONSOLE_LOGGING?.toLowerCase() !== 'false',
    maxFiles: process.env.LOG_MAX_FILES || '30d',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD',
    zippedArchive: process.env.LOG_ZIPPED_ARCHIVE !== 'false',
    disableMasking: process.env.DISABLE_SENSITIVE_DATA_MASKING?.toLowerCase() === 'true',
}));