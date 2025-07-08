import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ConfigModule } from '@nestjs/config';
import redisConfig from '../config/redis.config';

@Module({
    imports: [ ConfigModule.forRoot({ load: [redisConfig] }), ],
    providers: [RedisService],
    exports: [RedisService],
})
export class RedisModule {}

