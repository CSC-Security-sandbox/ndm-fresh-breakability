import { Body, Controller, Get, Headers, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { EulaService } from './eula.service';
import { UserPermissionResponse } from '../auth/user-permission-response-type';

@ApiTags('eula')
@Controller('/api/v1/eula')
export class EulaController {
  constructor(private readonly eulaService: EulaService) {}

  @Get('status')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user EULA status' })
  async getStatus(@Request() userPermissions: UserPermissionResponse) {
    return this.eulaService.getStatus(userPermissions?.user?.id);
  }

  @Post('accept')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept required EULA for current user' })
  async accept(@Request() userPermissions: UserPermissionResponse) {
    return this.eulaService.accept(userPermissions?.user?.id);
  }

  @Post('internal/accept-user')
  @ApiOperation({ summary: 'Internal endpoint to mark a specific user as EULA accepted' })
  async acceptUserInternal(
    @Headers('x-internal-api-key') internalApiKey: string | undefined,
    @Body() body: { userId: string },
  ) {
    return this.eulaService.acceptForUserViaApi(body.userId, internalApiKey);
  }

  @Post('internal/mark-pending')
  @ApiOperation({ summary: 'Internal endpoint to mark all users EULA pending for version' })
  async markPendingInternal(
    @Headers('x-internal-api-key') internalApiKey: string | undefined,
    @Body() body: { version: string },
  ) {
    await this.eulaService.markAllUsersPendingViaApi(body.version, internalApiKey);
    return { updated: true };
  }
}
