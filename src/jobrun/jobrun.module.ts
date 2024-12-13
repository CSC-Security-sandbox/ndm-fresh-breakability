import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigService } from 'src/jobconfig/jobconfig.service';
import { InventoryEntity } from 'src/entities/inventory.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity,InventoryEntity]),
    ],
    providers: [JobRunService, JobConfigService],
    controllers: [JobRunController]
})
export class JobRunModule {}
