export interface LoggerOptions {
    logsDir: string;
    logLevel?: string;
    enableFileLogging?: boolean;
    enableConsoleLogging?: boolean;
    maxFiles?: string;
    maxSize?: string;
    datePattern?: string;
    zippedArchive?: boolean;
    disableMasking?: boolean;
}