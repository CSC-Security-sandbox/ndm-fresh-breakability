import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Inject,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AsupSchedulerService } from './asup-scheduler.service';
import {
  AsupSettingsDto,
  SendSupportBundleDto,
  UpdateAsupSettingsDto,
} from './dto/asup.dto';

@ApiTags("asup")
@Controller("asup")
export class AsupController {
  private readonly logger: LoggerService;

  constructor(
    private readonly asupSchedulerService: AsupSchedulerService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(AsupController.name);
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
      const userId = (req as any).user?.id ?? null;
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

  @ApiOperation({ summary: 'Send generated support bundle to ASUP endpoint' })
  @ApiResponse({ status: 200, description: 'Support bundle sent successfully' })
  @Post('support-bundle/send')
  async sendSupportBundle(
    @Body() dto: SendSupportBundleDto,
  ): Promise<{ success: boolean }> {
    this.logger.log(`[SendSupportBundle] Request received - fileName=${dto?.fileName}, bundleBase64 length=${dto?.bundleBase64?.length ?? 0} chars`);
    try {
      const bundleBuffer = Buffer.from(dto.bundleBase64, 'base64');
      const bufferSizeMB = (bundleBuffer.length / (1024 * 1024)).toFixed(2);
      this.logger.log(`[SendSupportBundle] Decoded buffer size=${bufferSizeMB}MB - passing to transmitSupportBundle`);

      await this.asupSchedulerService.transmitSupportBundle(
        dto.fileName,
        bundleBuffer,
      );
      this.logger.log(`[SendSupportBundle] transmitSupportBundle completed successfully for fileName=${dto?.fileName}`);
      return { success: true };
    } catch (error) {
      this.logger.error(
        `[SendSupportBundle] Failed - fileName=${dto?.fileName}, error=${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to send support bundle to ASUP.',
      );
    }
  }

}