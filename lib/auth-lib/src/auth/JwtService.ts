import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksClient = require('jwks-rsa');
import { DecodedToken } from './types';
import { KeyclaokOptions } from '../config/types';



@Injectable()
export class JwtService {
  
  private client: jwksClient.JwksClient;
  private logger: Logger = new Logger(JwtService.name);

  constructor(private readonly configService: ConfigService) {
    const keycloakConfig = this.configService.get<KeyclaokOptions>('keycloakOptions');
    this.logger.log( `${keycloakConfig.keycloakBaseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`)
    this.client = jwksClient({
      jwksUri: `${keycloakConfig.keycloakBaseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`,
    });
  }

  private getKey(header: jwt.JwtHeader): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.getSigningKey(header.kid!, (err, key) => {
        if (err || !key) {
          return reject(err);
        }
        const signingKey = key.getPublicKey();
        resolve(signingKey);
      });
    });
  }

  async verifyToken(token: string): Promise<DecodedToken> {
    try {
      const decoded = await new Promise<DecodedToken>((resolve, reject) => {
        jwt.verify(
          token,
          async (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
            try {
              const signingKey = await this.getKey(header);
              callback(null, signingKey);
            } catch (error) {
              callback(error as jwt.VerifyErrors);
            }
          },
          {},
          (err: jwt.VerifyErrors | null, decoded: any | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve(decoded as DecodedToken);
            }
          }
        );
      });
      
      return decoded;
    } catch (error) {
      this.logger.error(`Token verification failed: ${error}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
