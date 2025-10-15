import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPermissionResponse } from './user-permission-response-type';
import { makeAxiosRequest } from '../utils/axios-request-utils';
import { encryptData } from '../utils/crypto-utils';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class AuthService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(AuthService.name);
  }

  public async getKeycloakToken() {
    try {
      this.logger.log('Requesting Keycloak token');

      const data = await makeAxiosRequest<{ access_token: string }>({
        method: 'POST',
        url: `${process.env.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
        data: new URLSearchParams({
          client_id: process.env.KEYCLOAK_ADMIN_CLIENT,
          username: process.env.KEYCLOAK_ADMIN_USERNAME,
          password: process.env.KEYCLOAK_ADMIN_PASSWORD,
          grant_type: 'password',
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      this.logger.log('Successfully obtained Keycloak token');
      return data.access_token;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to get Keycloak token, error: ${error.message}`,
      );
    }
  }

    public async checkUserHasRedisRole(userId: string): Promise<boolean> {
        try {
            this.logger.log('Getting Keycloak admin token...');

            // Reuse the existing getKeycloakToken method
            const adminToken = await this.getKeycloakToken();

            this.logger.log('Checking roles for service account user:', userId);

            // Check user roles using makeAxiosRequest (consistent with your codebase)
            const rolesResponse = await makeAxiosRequest<any[]>({
                method: 'GET',
                url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            const userRoles = rolesResponse.map(role => role.name);
            this.logger.log('User roles found:', userRoles);

            const hasRedisRole = rolesResponse.some(role => role.name === 'redis-secret-reader');


            return hasRedisRole;
        } catch (error) {
            this.logger.error('Failed to check user roles:', error.message);
            return false;
        }
    }

  private generateRandomPassword(length: number): string {
    const charSet = {
      lowerCase: 'abcdefghijklmnopqrstuvwxyz',
      upperCase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      digits: '0123456789',
      specialCharacters: '!@#$%^&*()-_=+[]{}|;:,.<>?',
    };
    const allCharacters = Object.values(charSet).join('');

    const getRandomChar = (chars: string): string => {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);

      return chars[array[0] % chars.length];
    };

    // Ensure at least one char of each required type is included
    const password = [
      getRandomChar(charSet.lowerCase),
      getRandomChar(charSet.upperCase),
      getRandomChar(charSet.digits),
      getRandomChar(charSet.specialCharacters),
    ];

    // Fill the rest of the password length with random characters
    for (let i = password.length; i < length; i++) {
      password.push(getRandomChar(allCharacters));
    }

    return password.join('');
  }

  async inviteUser(
    username: string,
    firstName: string,
    lastName: string,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<{ user: User; tempPassword: string }> {
    // Check if user already exists in the database
    try {
      const existingUser = await this.userRepository.findOne({
        where: { email: username },
      });
      if (existingUser) {
        throw new ConflictException(
          `Cannot create user: the email id '${username}' already exists.`,
        );
      }
      const tempPassword = this.generateRandomPassword(12);
      const token = await this.getKeycloakToken();
      const encryptedPassword = encryptData(tempPassword);
      await makeAxiosRequest({
        method: 'POST',
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        data: {
          username,
          enabled: true,
          firstName,
          lastName,
          email: username,
          credentials: [
            {
              type: 'password',
              value: tempPassword,
              temporary: true,
            },
          ],
          requiredActions: ['UPDATE_PASSWORD'],
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const user = this.userRepository.create({
        email: username,
        user_status: 'active',
        first_name: firstName,
        last_name: lastName,
      });

      user.populateWhoColumns(userPermissionResponse.user.id);
      const savedUser = await this.userRepository.save(user);

      return { user: savedUser, tempPassword: encryptedPassword };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to create user in Keycloak, error: ${error.message}`,
      );
    }
  }

  async resetPassword(email: string): Promise<string> {
    const newPassword = this.generateRandomPassword(12);
    const token = await this.getKeycloakToken();

    try {
      const encryptedPassword = encryptData(newPassword);
      const users = await makeAxiosRequest<any[]>({
        method: 'GET',
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        headers: { Authorization: `Bearer ${token}` },
        params: { email },
      });

      const keycloakUser = users[0];
      if (!keycloakUser) {
        throw new NotFoundException('User not found in Keycloak');
      }

      await makeAxiosRequest({
        method: 'PUT',
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}/reset-password`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          type: 'password',
          value: newPassword,
          temporary: true,
        },
      });

      return encryptedPassword;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to reset password in Keycloak, : error',
        error.message,
      );
    }
  }

  async setUserStatus(
    email: string,
    enable: boolean,
  ): Promise<{ message: string; user: User }> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException(
        `User not found, Please verify the user ID and try again.`,
      );
    }

    user.user_status = enable ? 'active' : 'inactive';
    await this.userRepository.save(user);

    const token = await this.getKeycloakToken();

    try {
      const users = await makeAxiosRequest<any[]>({
        method: 'GET',
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        headers: { Authorization: `Bearer ${token}` },
        params: { email },
      });

      if (users.length === 0) {
        throw new NotFoundException(
          'User not found in Keycloak, Please verify the user ID and try again.',
        );
      }

      const keycloakUser = users[0];

      await makeAxiosRequest({
        method: 'PUT',
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: { enabled: enable },
      });

      if (!enable) {
        await makeAxiosRequest({
          method: 'OPTIONS',
          url: `${process.env.KEYCLOAK_BASE_URL}/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id.toString().trim()}/logout`,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
      const state = enable ? 'enabled' : 'disabled';
      return {
        message: `Access has been successfully ${state} for a user: ${email}`,
        user,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to update user status in Keycloak, error: ${error.message}`,
      );
    }
  }
}
