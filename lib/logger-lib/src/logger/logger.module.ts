import { DynamicModule, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import 'winston-daily-rotate-file';
import loggerConfig from "../config/logger.config";
import { format, transports } from "winston";
import { LoggerService } from "./logger.service";
import { LoggerFactory } from "./logger.factory";
import { RequestContextModule } from "../middleware/request-context.module";
import { AsyncLocalStorageModule } from "../async-local-storage/async-local-storage.module";
import * as fs from 'fs';
import * as path from 'path';

@Module({})
export class LoggerModule {
    static forRoot() : DynamicModule{
        return {
            module: LoggerModule,
            imports : [
                // Importing RequestContextModule to provide RequestContext
                RequestContextModule,
                AsyncLocalStorageModule,
                ConfigModule.forRoot({load: [loggerConfig]}),
                WinstonModule.forRootAsync({
                    imports: [ConfigModule],
                    inject: [ConfigService],
                    useFactory: (cfg: ConfigService) => {
                        const loggerOptions = cfg.get('loggerOptions');
                        const transportsList: any[] = [];

                        // Add console transport if enabled
                        if (loggerOptions.enableConsoleLogging) {
                            const isTestEnv = process.env.NODE_ENV === 'test';
                            
                            transportsList.push(
                                new transports.Console({
                                    level: loggerOptions.logLevel,
                                    format: format.combine(
                                        format.timestamp(),
                                        format.colorize(),
                                        format.splat(),
                                        format.printf((info) => {
                                            const { timestamp, level, message, trackId, projectId, context, ...meta } = info;
                                            let metaString = '';
                                            
                                            // Build the main log line with spaces between elements
                                            let logLine = `${timestamp} [${level}]`;
                                            
                                            if (trackId) {
                                                logLine += ` ${trackId}`;
                                            }

                                            if (projectId) {
                                                logLine += ` projectId: ${projectId}`;
                                            }
                                            
                                            if (context) {
                                                logLine += ` [${context}]`;
                                            }
                                            
                                            logLine += `: ${message}`;
                                            
                                            // Add remaining metadata only if there are other fields
                                            if (Object.keys(meta).length > 0) {
                                                if (isTestEnv) {
                                                    // Prettify JSON in test environment for better readability
                                                    metaString = ` ${JSON.stringify(meta, null, 2)}`;
                                                } else {
                                                    // Compact JSON for production/development
                                                    metaString = ` ${JSON.stringify(meta)}`;
                                                }
                                            }
                                            
                                            return `${logLine}${metaString}`;
                                        }),
                                    ),
                                })
                            );
                        }

                        // Add file transports if file logging is enabled
                        if (loggerOptions.enableFileLogging) {
                            const isTestEnv = process.env.NODE_ENV === 'test';
                            
                            // Ensure log directory exists
                            const logDir = loggerOptions.logsDir;
                            if (!fs.existsSync(logDir)) {
                                try {
                                    fs.mkdirSync(logDir, { recursive: true });
                                } catch (error) {
                                    // Log error but don't fail if directory cannot be created
                                    console.warn(`Failed to create log directory ${logDir}:`, error instanceof Error ? error.message : String(error));
                                }
                            }
                            
                            // Create file format - compact for all environments
                            const fileFormat = format.combine(
                                format.timestamp(),
                                format.uncolorize(),
                                format.printf((info) => {
                                    // Compact format for file logging with spaces
                                    const { timestamp, level, message, trackId, projectId, context, ...meta } = info;
                                    let metaString = '';
                                    
                                    // Build the main log line with spaces between elements
                                    let logLine = `${timestamp} [${level}]`;
                                    
                                    if (trackId) {
                                        logLine += ` ${trackId}`;
                                    }

                                    if (projectId) {
                                        logLine += ` projectId: ${projectId}`;
                                    }
                                    
                                    if (context) {
                                        logLine += ` [${context}]`;
                                    }
                                    
                                    logLine += `: ${message}`;
                                    
                                    // Add remaining metadata only if there are other fields
                                    if (Object.keys(meta).length > 0) {
                                        metaString = ` ${JSON.stringify(meta)}`;
                                    }
                                    
                                    return `${logLine}${metaString}`;
                                })
                            );

                            transportsList.push(
                                new transports.DailyRotateFile({
                                    filename: `${loggerOptions.logsDir}/%DATE%-error.log`,
                                    level: 'error',
                                    datePattern: loggerOptions.datePattern,
                                    format: fileFormat,
                                    zippedArchive: loggerOptions.zippedArchive,
                                    maxFiles: loggerOptions.maxFiles,
                                    maxSize: loggerOptions.maxSize
                                }),
                                new transports.DailyRotateFile({
                                    filename: `${loggerOptions.logsDir}/%DATE%-combined.log`,
                                    level: loggerOptions.logLevel,
                                    datePattern: loggerOptions.datePattern,
                                    format: fileFormat,
                                    zippedArchive: loggerOptions.zippedArchive,
                                    maxFiles: loggerOptions.maxFiles,
                                    maxSize: loggerOptions.maxSize
                                })
                            );
                        }

                        return {
                            transports: transportsList
                        };
                    }
                })
            ],
            exports: [LoggerFactory, LoggerService, RequestContextModule, AsyncLocalStorageModule],
            providers:[LoggerFactory, LoggerService]
        }
    }
}
