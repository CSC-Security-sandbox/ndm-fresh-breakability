import { Body, Controller, Get, Inject, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from './user-permission-response-type';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

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
  private logger: LoggerService;
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
}
