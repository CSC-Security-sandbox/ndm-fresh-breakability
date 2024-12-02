import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQConfigService } from './rabbitmq.config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [RabbitMQConfigService],
  exports: [RabbitMQConfigService],
})
export class AppConfigModule {}
