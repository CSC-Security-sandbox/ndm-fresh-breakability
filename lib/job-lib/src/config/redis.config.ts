import { registerAs } from "@nestjs/config";
import { RedisOptions } from "./redis.config.type";
import { GroupReaderType } from "../constant/enum";

export default registerAs('redisOptions', (): RedisOptions => ({
    redisHost: process.env.REDIS_HOST || '127.0.0.1',
    redisPort: parseInt(process.env.REDIS_PORT, 10) || 6379,
    redisPassword: process.env.REDIS_PASSWORD,
    redisUsername: process.env.REDIS_USERNAME,
    readerGroup: process.env.REDIS_READER_GROUP || GroupReaderType.WORKER
}));


