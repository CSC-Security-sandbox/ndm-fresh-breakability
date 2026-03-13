import {
  Controller,
  Get,
  Put,
  Body,
  Inject,
  Req,
  Headers,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AsupSchedulerService } from './asup-scheduler.service';
import {
  AsupSettingsDto,
  UpdateAsupSettingsDto,
} from './dto/asup.dto';

@ApiTags("asup")
@Controller("asup")
export class AsupController {
  private readonly logger: LoggerService;
  private readonly internalSecret: string;

  constructor(
    private readonly asupSchedulerService: AsupSchedulerService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {
    this.logger = loggerFactory.create(AsupController.name);
    this.internalSecret = this.configService.get<string>('KEYCLOAK_INTERNAL_SECRET') || '';
  }

  // ─── Settings (get/update ASUP enabled) ───────────────────────────────────

  @ApiOperation({ summary: "Get ASUP settings" })
  @ApiResponse({ status: 200, description: "Returns current ASUP settings" })
  @Get("settings")
  async getAsupSettings(): Promise<AsupSettingsDto> {
    try {
      const settings = await this.asupSchedulerService.getAsupSettings();
      return {
        enabled: settings.enabled,
        ...(settings.lastUpdated != null && { lastUpdated: settings.lastUpdated }),
      };
    } catch (error) {
      this.logger.error(
        `getAsupSettings failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Something went wrong, please try again.',
      );
    }
  }

  @ApiOperation({ summary: "Update ASUP settings" })
  @ApiResponse({ status: 200, description: "Returns updated ASUP settings" })
  @ApiBody({ type: UpdateAsupSettingsDto })
  @ApiBearerAuth()
  @Put("settings")
  async updateAsupSettings(
    @Body() updateDto: UpdateAsupSettingsDto,
    @Req() req: Request,
    @Headers('x-internal-service-secret') internalSecret?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ): Promise<AsupSettingsDto> {
    try {
      let userId: string | null = null;
      
      // Allow internal calls from Keycloak with shared secret (bypasses JWT auth)
      if (internalSecret && this.internalSecret && internalSecret === this.internalSecret) {
        userId = userIdHeader || null;
        this.logger.log(`ASUP settings update via internal service call: enabled=${updateDto.enabled}`);
      } else {
        // Regular UI calls require JWT authentication (same as Help toggle)
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          throw new Error('Authorization required');
        }
        const token = authHeader.split(' ')?.[1];
        if (!token) {
          throw new Error('JWT token missing');
        }
        try {
          const decoded = await this.jwtService.verifyToken(token);
          if (!decoded.user) {
            throw new Error('Invalid token');
          }
          // Check for Reports permission
          const project = req.headers.projectid as string;
          let hasPermission = false;
          for (const role of decoded.user.roles) {
            if (role.projects.length === 0 || role.projects?.includes(project)) {
              const permMap = new Set<string>(role.permissions);
              if (permMap.has(Permission.Reports)) {
                hasPermission = true;
                break;
              }
            }
          }
          if (!hasPermission) {
            throw new Error('Insufficient permissions');
          }
          // Get user ID from token - use sub (subject) or id if available
          userId = (decoded.user as any).id || decoded.sub || null;
        } catch (error) {
          throw new Error(`JWT validation failed: ${(error as Error).message}`);
        }
      }
      
      const enabled = updateDto.enabled === true;
      const updated = await this.asupSchedulerService.updateAsupSettings(
        enabled,
        userId,
      );
      return {
        enabled: updated.enabled,
        ...(updated.lastUpdated != null && { lastUpdated: updated.lastUpdated }),
      };
    } catch (error) {
      this.logger.error(
        `updateAsupSettings failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Something went wrong, please try again.',
      );
    }
  }

}