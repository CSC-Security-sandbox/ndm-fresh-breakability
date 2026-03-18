import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { DiscoveryService } from './discovery.service';
import { ReportsEntity } from 'src/entities/reports.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { QueryTokenMiddleware } from 'src/middleware/query-token.middleware';

@Module({
    imports: [
        TypeOrmModule.forFeature([InventoryEntity, ReportsEntity]),
        AuthKeycloakModule,
        LoggerModule.forRoot()
    ],
    providers: [DiscoveryService],
    controllers: [DiscoveryController],
})
export class DiscoveryModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(QueryTokenMiddleware).forRoutes('inventory/download');
    }
}
