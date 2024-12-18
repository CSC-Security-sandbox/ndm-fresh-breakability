import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { DiscoveryService } from './discovery.service';
import { ReportsEntity } from 'src/entities/reports.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([InventoryEntity, ReportsEntity]),
    ],
    providers: [DiscoveryService],
    controllers: [DiscoveryController],
})
export class DiscoveryModule {}
