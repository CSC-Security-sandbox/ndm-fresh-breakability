import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import redisConfig from '../config/redis.config';
import { ConfigModule } from '@nestjs/config';
import { JobManger } from './job-manager.service';
import { StreamService } from './data-store/stream/stream.service';
import { HashSetService } from './data-store/hashset/hashset.service';

@Module({
    imports: [ ConfigModule.forRoot({ load: [redisConfig] }), RedisModule ],
    providers: [JobManger, StreamService, HashSetService],
    exports: [JobManger, StreamService, HashSetService],
})
export class JobManagerModule {}
