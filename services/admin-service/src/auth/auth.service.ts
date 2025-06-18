import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPermissionResponse } from './user-permission-response-type';
import { makeAxiosRequest } from '../utils/axios-request-utils';
import { RequestContext } from '../common/request-context';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class AuthService {
  private readonly logger;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private loggerFactory: LoggerFactory,
  ) {
    this.logger = this.loggerFactory.create(AuthService.name);
  }

  public async getKeycloakToken() {
    const traceId = RequestContext.getTraceId();
    this.logger.log('Attempting to get Keycloak token', traceId);

    try {
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

      this.logger.log('Successfully obtained Keycloak token', traceId);
      return data.access_token;
    } catch (error) {
      this.logger.error(`Failed to get Keycloak token: ${error.message}`, traceId);
      throw new InternalServerErrorException(
        `Failed to get Keycloak token, error: ${error.message}`,
      );
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
    const traceId = RequestContext.getTraceId();
    try {
      // Check if user already exists in the database
      const existingUser = await this.userRepository.findOne({ where: { email: username } });
      if (existingUser) {
        this.logger.warn(`Cannot create user: the email id '${username}' already exists.`, traceId);
        throw new ConflictException(
          `Cannot create user: the email id '${username}' already exists.`
        );
      }

      // Generate password and get Keycloak token
      this.logger.log(`Generating temporary password for user ${username}`, traceId);
      const tempPassword = this.generateRandomPassword(12);

      this.logger.log(`Getting Keycloak token for user creation`, traceId);
      const token = await this.getKeycloakToken();

      try {
        // Create user in Keycloak
        this.logger.log(`Creating user ${username} in Keycloak`, traceId);
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

        this.logger.log(`Successfully created user ${username} in Keycloak`, traceId);

        try {
          // Create user in database
          this.logger.log(`Creating user ${username} in database`, traceId);
          const user = this.userRepository.create({
            email: username,
            user_status: 'active',
            first_name: firstName,
            last_name: lastName,
          });

          user.populateWhoColumns(userPermissionResponse.user.id);

          this.logger.log(`Saving user ${username} to database`, traceId);
          const savedUser = await this.userRepository.save(user);

          this.logger.log(`Successfully saved user ${username} in database with ID: ${savedUser.id}`, traceId);

          return { user: savedUser, tempPassword };
        } catch (dbError) {
          // Handle database error
          this.logger.error(`Failed to save user in database: ${dbError.message}`, traceId);

          throw new InternalServerErrorException(
            `Failed to save user in database: ${dbError.message}`
          );
        }
      } catch (keycloakError) {
        // Handle Keycloak error
        if (keycloakError instanceof ConflictException) {
          this.logger.error(`Conflict error during user creation in Keycloak: ${keycloakError.message}`, traceId);
          throw keycloakError;
        }

        this.logger.error(`Failed to create user in Keycloak: ${keycloakError.message}`, traceId);
        throw new InternalServerErrorException(
          `Failed to create user in Keycloak: ${keycloakError.message}`
        );
      }
    } catch (error) {
      // Handle any other errors
      if (error instanceof ConflictException ||
          error instanceof InternalServerErrorException) {
        throw error; // Re-throw already handled errors
      }

      this.logger.error(`Unexpected error during user invitation: ${error.message}`, traceId);
      throw new InternalServerErrorException(
        `Unexpected error during user invitation: ${error.message}`
      );
    }
  }

  async resetPassword(email: string): Promise<string> {
    const traceId = RequestContext.getTraceId();
    this.logger.log(`Starting password reset process for user ${email}`, traceId);

    // Input validation
    if (!email || !email.trim()) {
      const errorMsg = 'Email is required for password reset';
      this.logger.error(errorMsg, traceId);
      throw new BadRequestException(errorMsg);
    }

    try {
      // Generate new password
      this.logger.log(`Generating new password for user ${email}`, traceId);
      const newPassword = this.generateRandomPassword(12);

      // Get Keycloak token
      this.logger.log(`Getting Keycloak token for password reset`, traceId);
      const token = await this.getKeycloakToken();

      try {
        // Find user in Keycloak
        this.logger.log(`Finding user ${email} in Keycloak`, traceId);
        const users = await makeAxiosRequest<any[]>({
          method: 'GET',
          url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
          headers: { Authorization: `Bearer ${token}` },
          params: { email },
        });

        const keycloakUser = users[0];
        if (!keycloakUser) {
          const errorMsg = `User with email ${email} not found in Keycloak`;
          this.logger.error(errorMsg, traceId);
          throw new NotFoundException(errorMsg);
        }

        // Reset password in Keycloak
        this.logger.log(`Resetting password for user ${email} in Keycloak`, traceId);
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

        this.logger.log(`Successfully reset password for user ${email}`, traceId);
        return newPassword;
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw error; // Re-throw NotFoundException
        }

        this.logger.error(`Failed to reset password in Keycloak: ${error.message}`, traceId);
        throw new InternalServerErrorException(
          `Failed to reset password in Keycloak: ${error.message}`
        );
      }
    } catch (error) {
      // Handle any other errors
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException || 
          error instanceof InternalServerErrorException) {
        throw error; // Re-throw already handled errors
      }

      this.logger.error(`Unexpected error during password reset: ${error.message}`, traceId);
      throw new InternalServerErrorException(
        `Unexpected error during password reset: ${error.message}`
      );
    }
  }

  async setUserStatus(email: string, enable: boolean): Promise<User> {
    const traceId = RequestContext.getTraceId();
    this.logger.log(`Starting user status update for ${email} to ${enable ? 'active' : 'inactive'}`, traceId);

    // Input validation
    if (!email || !email.trim()) {
      const errorMsg = 'Email is required for user status update';
      this.logger.error(errorMsg, traceId);
      throw new BadRequestException(errorMsg);
    }

    if (enable === undefined || enable === null) {
      const errorMsg = 'Enable flag is required for user status update';
      this.logger.error(errorMsg, traceId);
      throw new BadRequestException(errorMsg);
    }

    try {
      // Find user in database
      this.logger.log(`Finding user ${email} in database`, traceId);
      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        const errorMsg = `User with email ${email} not found in database`;
        this.logger.error(errorMsg, traceId);
        throw new NotFoundException(errorMsg);
      }

      try {
        // Update user status in database
        this.logger.log(`Updating user ${email} status to ${enable ? 'active' : 'inactive'} in database`, traceId);
        user.user_status = enable ? 'active' : 'inactive';
        const savedUser = await this.userRepository.save(user);
        this.logger.log(`Successfully updated user ${email} status in database`, traceId);

        try {
          // Get Keycloak token
          this.logger.log(`Getting Keycloak token for user status update`, traceId);
          const token = await this.getKeycloakToken();

          // Find user in Keycloak
          this.logger.log(`Finding user ${email} in Keycloak`, traceId);
          const users = await makeAxiosRequest<any[]>({
            method: 'GET',
            url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
            headers: { Authorization: `Bearer ${token}` },
            params: { email },
          });

          if (users.length === 0) {
            const errorMsg = `User with email ${email} not found in Keycloak`;
            this.logger.error(errorMsg, traceId);
            throw new NotFoundException(errorMsg);
          }

          const keycloakUser = users[0];

          // Update user status in Keycloak
          this.logger.log(`Updating user ${email} status to ${enable ? 'enabled' : 'disabled'} in Keycloak`, traceId);
          await makeAxiosRequest({
            method: 'PUT',
            url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}`,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            data: { enabled: enable },
          });

          // Logout user if disabling
          if (!enable) {
            this.logger.log(`Logging out user ${email} from Keycloak as account is being disabled`, traceId);
            await makeAxiosRequest({
              method: 'OPTIONS',
              url: `${process.env.KEYCLOAK_BASE_URL}/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id.toString().trim()}/logout`,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
          }

          this.logger.log(`Successfully updated user ${email} status in Keycloak`, traceId);
          return savedUser;
        } catch (keycloakError) {
          // Handle Keycloak error
          if (keycloakError instanceof NotFoundException) {
            this.logger.warn(`User ${email} not found in Keycloak but exists in database`, traceId);
            // Return the user anyway since we updated the database successfully
            return savedUser;
          }

          this.logger.error(`Failed to update user status in Keycloak: ${keycloakError.message}`, traceId);
          throw new InternalServerErrorException(
            `Failed to update user status in Keycloak: ${keycloakError.message}`
          );
        }
      } catch (dbError) {
        // Handle database error
        if (dbError instanceof InternalServerErrorException) {
          throw dbError; // Re-throw already handled errors
        }

        this.logger.error(`Failed to update user status in database: ${dbError.message}`, traceId);
        throw new InternalServerErrorException(
          `Failed to update user status in database: ${dbError.message}`
        );
      }
    } catch (error) {
      // Handle any other errors
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException || 
          error instanceof InternalServerErrorException) {
        throw error; // Re-throw already handled errors
      }

      this.logger.error(`Unexpected error during user status update: ${error.message}`, traceId);
      throw new InternalServerErrorException(
        `Unexpected error during user status update: ${error.message}`
      );
    }
  }
}
