import {
  Controller,
  Get,
  Put,
  Body,
  Inject,
  Req,
  Headers,
  InternalServerErrorException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Auth, JwtService, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AsupSchedulerService } from './asup-scheduler.service';
import {
  AsupSettingsDto,
  UpdateAsupSettingsDto,
} from './dto/asup.dto';

// Type definitions for decoded JWT token
interface DecodedUserRole {
  readonly projects?: ReadonlyArray<string>;
  readonly permissions: ReadonlyArray<string>;
}

interface DecodedUser {
  readonly id?: string;
  readonly roles: ReadonlyArray<DecodedUserRole>;
}

interface DecodedTokenPayload {
  readonly user?: DecodedUser;
  readonly sub?: string;
}

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
  @Auth(Permission.Reports)
  @Put("settings")
  async updateAsupSettings(
    @Body() updateDto: UpdateAsupSettingsDto,
    @Req() req: Request,
  ): Promise<AsupSettingsDto> {
    try {
      let userId: string | null = null;

      // Rely on shared auth guard for permission checks; only extract userId here
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new UnauthorizedException('Authorization header required');
      }
      const token = authHeader.split(' ')?.[1];
      if (!token) {
        throw new UnauthorizedException('JWT token missing');
      }
      try {
        const decoded = await this.jwtService.verifyToken(token) as DecodedTokenPayload;
        if (!decoded || !decoded.user) {
          throw new UnauthorizedException('Invalid token');
        }
        // Prefer user.id; fallback to sub
        const candidate =
          (typeof decoded.user.id === 'string' && decoded.user.id) ||
          (typeof decoded.sub === 'string' && decoded.sub) ||
          null;
        // Basic UUID v4-ish guard (keep null if not a UUID to avoid 500s downstream)
        const uuidRegex =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
        userId = candidate && uuidRegex.test(candidate) ? candidate : null;
      } catch (error: unknown) {
        if (error instanceof HttpException) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new UnauthorizedException(`JWT validation failed: ${message}`);
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
    } catch (error: unknown) {
      // Re-throw HttpExceptions (401, 403) without converting to 500
      if (error instanceof HttpException) {
        this.logger.error(
          `updateAsupSettings failed: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `updateAsupSettings failed: ${message}`,
        stack,
      );
      throw new InternalServerErrorException(
        'Something went wrong, please try again.',
      );
    }
  }

  // Internal-only endpoint for Keycloak listener (shared secret bypass)
  @ApiOperation({ summary: "Update ASUP settings (internal)" })
  @ApiResponse({ status: 200, description: "Returns updated ASUP settings" })
  @ApiBody({ type: UpdateAsupSettingsDto })
  @Put("settings/internal")
  async updateAsupSettingsInternal(
    @Body() updateDto: UpdateAsupSettingsDto,
    @Headers('x-internal-service-secret') internalSecret?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ): Promise<AsupSettingsDto> {
    try {
      if (!this.internalSecret || internalSecret !== this.internalSecret) {
        throw new UnauthorizedException('Invalid internal service secret');
      }
      const enabled = updateDto.enabled === true;
      // Accept userId only if it looks like a UUID; otherwise use null
      const uuidRegex =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
      const userId =
        typeof userIdHeader === 'string' && uuidRegex.test(userIdHeader)
          ? userIdHeader
          : null;
      this.logger.log(
        `ASUP settings update via internal call: enabled=${enabled}, userId=${userId ?? 'null'}`,
      );
      const updated = await this.asupSchedulerService.updateAsupSettings(
        enabled,
        userId,
      );
      return {
        enabled: updated.enabled,
        ...(updated.lastUpdated != null && { lastUpdated: updated.lastUpdated }),
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        this.logger.error(
          `updateAsupSettingsInternal failed: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `updateAsupSettingsInternal failed: ${message}`,
        stack,
      );
      throw new InternalServerErrorException(
        'Something went wrong, please try again.',
      );
    }
  }

}