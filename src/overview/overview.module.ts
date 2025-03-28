import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from 'src/entities/project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryEntity,ProjectEntity])],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
