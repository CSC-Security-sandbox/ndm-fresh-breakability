import { Body, Controller, Get, Post, Request, ForbiddenException, Logger, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Auth, Permission, AuthWorker } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from './user-permission-response-type';
import {
    LoggerFactory,
    LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

class InviteUserDto {
  username: string;
  firstName: string;
  lastName: string;
}

class UserStatusDto {
  email: string;
  enable: boolean;
}

@ApiTags('auth')
@Controller('/api/v1')
export class AuthController {
    private readonly logger: LoggerService;
  constructor(
    private readonly authService: AuthService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
      this.logger = loggerFactory.create(AuthController.name);
    }

  @Auth()
  @ApiBearerAuth()
  @Get('user-permissions')
  @ApiOperation({
    summary: 'Get User Permissions',
  })
  getPermissions(@Request() req: any) {
    return req.user;
  }

  @Auth(Permission.InviteUser, Permission.CreateUser)
  @ApiBearerAuth()
  @Post('create-user')
  @ApiOperation({
    summary:
      'Invite a new user without permissions roles or project for keycloak entry',
  })
  @ApiBody({
    description: 'Invite a user with their username and name',
    type: InviteUserDto,
    examples: {
      'application/json': {
        value: {
          username: 'testUser@email.com',
          firstName: 'Test',
          lastName: 'User',
        },
      },
    },
  })
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    const { username, firstName, lastName } = inviteUserDto;
    return this.authService.inviteUser(
      username,
      firstName,
      lastName,
      userPermissionResponse,
    );
  }

  @Auth(Permission.InviteUser, Permission.CreateUser)
  @ApiBearerAuth()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset a user password and return the newly generated password',
  })
  @ApiBody({
    description: 'Reset a user password by providing their email',
    type: Object,
    examples: {
      'application/json': {
        value: {
          email: 'testUser@email.com',
        },
      },
    },
  })
  async resetPassword(@Body('email') email: string) {
    const newPassword = await this.authService.resetPassword(email);
    return { email, newPassword };
  }

  @Auth(Permission.InviteUser, Permission.CreateUser)
  @ApiBearerAuth()
  @Post('user-status')
  @ApiOperation({
    summary: 'Enable or disable a user based on the email and enable flag',
  })
  @ApiBody({
    description: 'Enable or disable a user by email',
    type: UserStatusDto,
    examples: {
      'application/json': {
        value: {
          email: 'testUser@email.com',
          enable: true,
        },
      },
    },
  })
  async setUserStatus(@Body() userStatusDto: UserStatusDto) {
    const { email, enable } = userStatusDto;
    return await this.authService.setUserStatus(email, enable);
  }

  @Get('secrets/redis')
  @AuthWorker()
  @ApiOperation({
    summary: 'Get Redis credentials for authenticated workers',
  })
  async getRedisCredentials(@Request() req) {
    try {
      // @AuthWorker() should populate req.user automatically
      this.logger.debug(`getRedisCredentials called`);
      const user = req.user;

      this.logger.debug('Checking Redis access for user:', user?.preferred_username);
      this.logger.debug('User ID (sub):', user?.sub);
      this.logger.debug('Client ID:', user?.client_id);

      // Check if it's a service account (optional - @AuthWorker might already validate this)
      if (!user?.preferred_username?.startsWith('service-account-')) {
        this.logger.warn('Access denied - not a service account');
        throw new ForbiddenException('Access restricted to service accounts');
      }

      // Check for Redis role using the service account user ID
      const hasAccess = await this.authService.checkUserHasRedisRole(user.sub);

      if (!hasAccess) {
        this.logger.warn('Access denied - user does not have redis-secret-reader role');
        throw new ForbiddenException('Missing redis-secret-reader role');
      }

      this.logger.log('Redis access granted with proper role');
      return {
        host: process.env.REDIS_HOST,
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      };
    } catch (error) {
      this.logger.error('Redis access check failed:', error.message);

      throw error;
    }
  }

}