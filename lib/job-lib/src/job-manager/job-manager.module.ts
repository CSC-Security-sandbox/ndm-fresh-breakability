import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import redisConfig from '../config/redis.config';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ ConfigModule.forRoot({ load: [redisConfig] }), RedisModule ],
    providers: [],
    exports: [],
})
export class JobManagerModule {}
