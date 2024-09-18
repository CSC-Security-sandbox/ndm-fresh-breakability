import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import rabbitmqConfig from './config/rabbitmq.config';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
import { InventoryModel, InventorySchema } from './schemas/inventory.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [rabbitmqConfig],
    }),
    MongooseModule.forRoot(process.env.MONGO_URI || 'mongodb://localhost:27017/test3?directConnection=true'),
    MongooseModule.forFeature([{ name: 'Inventory', schema: InventorySchema }]),
    InventoryModel
  ],
  controllers: [AppController, InventoryController],
  providers: [AppService, InventoryService],
})
export class AppModule {}
