import { ConfigObject, registerAs } from '@nestjs/config';

/**
 * Temporal configuration module.
 * 
 * Note: TLS and JWT connection logic is handled by the createNativeConnection()
 * and createClientConnection() utility functions in src/utils/temporal.utils.ts
 * 
 * This config only provides the Temporal address for services.
 */
export default registerAs(
  'temporal',
  (): ConfigObject => ({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  }),
);