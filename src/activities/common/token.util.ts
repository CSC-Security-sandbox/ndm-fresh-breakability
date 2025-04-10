import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

let accessToken: string | null = null;
let expiresAt: number = 0;

export async function getAccessTokens(
  httpService: HttpService,
  configService: ConfigService,
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (accessToken && now < expiresAt) return accessToken;

  const keycloakBaseUrl = configService.get('keycloak.baseUrl');
  const realm = configService.get('keycloak.realm');
  const clientId = configService.get('worker.workerId');
  const clientSecret = configService.get('keycloak.workerSecret');

  const tokenData = new URLSearchParams();
  tokenData.append('client_id', clientId);
  tokenData.append('client_secret', clientSecret);
  tokenData.append('grant_type', 'client_credentials');

  try {
    const response = await lastValueFrom(
      httpService.post(
        `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/token`,
        tokenData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    accessToken = response.data.access_token;
    expiresAt = now + response.data.expires_in - 10;
    return accessToken;
  } catch (error) {
    console.error(`Failed to obtain access token: ${error.message}`);
    return null;
  }
}
