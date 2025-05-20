import { DynamicModule, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import 'winston-daily-rotate-file';
import loggerConfig from "../config/logger.config";
import { RequestLoggerMiddleware } from "../middleware/request-logger.middleware";
import { format, transports } from "winston";
import { LoggerService } from "./logger.service";
import { LoggerFactory } from "./logger.factory";


@Module({})
export class LoggerModule {
    static forRoot() : DynamicModule{
        return {
            module: LoggerModule,
            imports : [
                ConfigModule.forRoot({load: [loggerConfig]}),
                WinstonModule.forRootAsync({
                    imports: [ConfigModule],
                    inject: [ConfigService],
                    useFactory: (cfg: ConfigService) => ({
                        transports: [
                            new transports.DailyRotateFile({
                                filename: `${cfg.get<string>('loggerOptions.service')}/logs/%DATE%-error.log`,
                                level: 'error',
                                datePattern: 'YYYY-MM-DD',
                                format: format.combine(format.timestamp(), format.json()),
                                zippedArchive: true, 
                                maxFiles: '30d'
                            }),
                            new transports.DailyRotateFile({
                                filename: `${cfg.get<string>('loggerOptions.service')}/logs/%DATE%-combined.log`,
                                format: format.combine(format.timestamp(), format.json()),
                                datePattern: 'YYYY-MM-DD',
                                zippedArchive: true, 
                                maxFiles: '30d'
                              }),
                            new transports.Console({
                                format: format.combine(
                                    format.cli(),
                                    format.splat(),
                                    format.timestamp(),
                                    format.printf((info) => `${info.timestamp} ${info.level}: ${info.message} ${JSON.stringify(info)}`),
                                ),
                            }),
                
                        ]
                    })
                })
            ],
            exports: [LoggerModule, RequestLoggerMiddleware, LoggerFactory, LoggerService],
            providers:[RequestLoggerMiddleware, LoggerFactory, LoggerService]
        }
    }
}