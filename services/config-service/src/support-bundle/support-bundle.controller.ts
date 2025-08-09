import {
  Controller,
  Post,
  Body,
  Request,
  Get,
  Res,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { SupportBundleService } from './support-bundle.service';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { BundleStatus, UserDetails } from 'src/constants/types';
import { Response } from 'express';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('support-bundle')
export class SupportBundleController {
  private logger: LoggerService;

  constructor(
    private readonly supportBundleService: SupportBundleService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(SupportBundleController.name);
  }

  @ApiOperation({
    summary: 'Create a support bundle entry in a table & start the workflow',
    description:
      'Create a support bundle entry in a table & start the workflow',
  })
  @ApiBearerAuth()
  @Auth()
  @Post()
  async create(
    @Body() createSupportBundleDTO: CreateSupportBundleDTO,
    @Request() userDetails: UserDetails,
  ) {
    return this.supportBundleService.create(
      createSupportBundleDTO,
      userDetails,
    );
  }

  @ApiOperation({ summary: 'Update workflow status by traceId' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({
    status: 404,
    description: 'Support bundle not found for traceId',
  })
  @Post('workflow-status-update')
  async updateStatus(@Body() updateStatusDto: UpdateStatusDto) {
    return await this.supportBundleService.updateSupportBundleStatus(
      updateStatusDto,
    );
  }

  @ApiOperation({ summary: 'Check if bundle is ready for download' })
  @ApiQuery({
    name: 'userId',
    type: String,
    required: true,
    description: 'User ID to check bundle status',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns whether the bundle is ready for download',
    schema: {
      example: {
        isProcessing: false,
        isBundleReady: true,
        error: null,
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Support bundle generation failed',
  })
  @ApiBearerAuth()
  @Auth()
  @Get('is-bundle-ready')
  async isBundleReady(
    @Request() userDetails: UserDetails,
  ): Promise<BundleStatus> {
    return await this.supportBundleService.isBundleReady(userDetails.user.id);
  }

  @ApiOperation({ summary: 'Download a support bundle ZIP file by name' })
  @ApiParam({
    name: 'fileName',
    description: 'File name without zip extension (e.g., ndm_logs)',
  })
  @ApiBearerAuth()
  @Auth()
  @Get('download')
  async downloadSupportBundle(
    @Request() userDetails: UserDetails,
    @Res() res: Response,
  ) {
    const fullFileName = `ndm_${userDetails?.user?.id}.zip`;
    const filePath =
      this.supportBundleService.downloadSupportBundle(fullFileName);

    return res.download(filePath, fullFileName, (err) => {
      if (err) {
        throw new NotFoundException(
          'Support bundle File not found or could not be downloaded.',
        );
      }
    });
  }

  @ApiOperation({
    summary: 'Get projects associated to a User',
    description:
      'Get list of projects associated to a User & workers list associated to a project',
  })
  @ApiBearerAuth()
  @Auth()
  @Get()
  async getProjects(@Request() userDetails: UserDetails) {
    return this.supportBundleService.getProjects(userDetails);
  }
}
