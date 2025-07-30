import { Module } from '@nestjs/common';
import {ResponseInterceptor} from "./response-interceptor";
import {LoggerModule} from "@netapp-cloud-datamigrate/logger-lib";

@Module({
    imports: [LoggerModule.forRoot()],
    exports: [ResponseInterceptor],
})
export class ResponseHandlerModule {}