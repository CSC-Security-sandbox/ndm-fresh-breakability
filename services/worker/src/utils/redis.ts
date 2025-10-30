import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthService } from 'src/auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

export interface RedisCredentials {
  host: string;
  username: string;
  password: string;
}

export async function fetchRedisCredentials(
  httpService: HttpService,
  authService: AuthService,
  configService: ConfigService,
  logger: LoggerService,
): Promise<RedisCredentials> {
  const workerConfigUrl = configService.get('worker.connection.workerConfigUrl');
  const workerId = configService.get('worker.workerId');

  logger.log('=== Starting Redis credentials fetch ===');
  logger.log(`Worker ID: ${workerId}`);
  
  try {
    // Get access token
    const accessToken = await authService.getAccessToken();
    if (!accessToken) {
      throw new Error('Failed to get access token');
    }

    // Fetch Redis credentials from API
    const response = await firstValueFrom(
      httpService.get(
        `${workerConfigUrl}/api/v1/secrets/redis`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      ),
    );

    if (response.status !== 200) {
      throw new Error(`Failed to fetch Redis credentials. Status: ${response.status}`);
    }

    logger.debug(`Redis response: ${JSON.stringify(response.data)}`);

    // Parse Redis credentials
    const data = response.data?.data?.items;
    if (!data?.host || !data?.username || !data?.password) {
      throw new Error('Incomplete Redis credentials received from API');
    }

    const redisCredentials: RedisCredentials = {
      host: data.host,
      username: data.username,
      password: data.password,
    };

    logger.log('Redis credentials fetched successfully:');
    logger.log(`  Host: ${redisCredentials.host}`);
    logger.log(`  Username: ${redisCredentials.username}`);
    logger.log(`  Password length: ${redisCredentials.password.length}`);

    return redisCredentials;

  } catch (error) {
    logger.error(`Failed to fetch Redis credentials: ${error.message}`);
    throw new Error(`Redis credentials are required for worker operation: ${error.message}`);
  }
}

export function updateRedisConfig(credentials: RedisCredentials, logger: LoggerService): void {
  if (!credentials) {
    throw new Error('Redis credentials not available');
  }

  // Update environment variables with Redis credentials
  process.env.REDIS_USERNAME = credentials.username;
  process.env.REDIS_PASSWORD = credentials.password;

  logger.log('Redis configuration updated successfully');
}

export async function fetchAndUpdateRedisCredentials(
  httpService: HttpService,
  authService: AuthService,
  configService: ConfigService,
  logger: LoggerService,
): Promise<RedisCredentials> {
  const credentials = await fetchRedisCredentials(httpService, authService, configService, logger);
  updateRedisConfig(credentials, logger);
  return credentials;
}