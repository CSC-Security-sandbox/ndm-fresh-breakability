import { ConfigObject, registerAs } from '@nestjs/config';

export default registerAs(
  'temporal',
  (): ConfigObject => ({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:8233',
  }),
);
