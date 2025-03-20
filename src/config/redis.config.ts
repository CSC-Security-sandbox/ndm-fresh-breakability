import { ConfigObject, registerAs } from '@nestjs/config';

export default registerAs(
  'redis',
  (): ConfigObject => ({
    url: process.env.REDIS_URL || 'redis:6379',
  }),
);
