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
            exports: [LoggerFactory, LoggerService, RequestContextModule, AsyncLocalStorageModule],
            providers:[LoggerFactory, LoggerService]
        }
    }
}
