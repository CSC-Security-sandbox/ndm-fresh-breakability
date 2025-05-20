import { Logger, Module } from '@nestjs/common';
import { WorkerThreadService } from './worker.thread.service';
import { ConfigModule } from '@nestjs/config';


@Module({
    imports: [ConfigModule],
    providers:[WorkerThreadService, Logger],
    exports: [WorkerThreadService]
})
export class WorkerThreadModule {}
