import {
  Controller,
  Post,
  Body,
  Request,
  Get,
  Param,
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
import { UserDetails } from 'src/constants/types';
import { Response } from 'express';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Controller('support-bundle')
export class SupportBundleController {
  private logger: LoggerService;

  constructor(private readonly supportBundleService: SupportBundleService,
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

  @ApiOperation({ summary: 'Check if user can download bundle' })
  @ApiQuery({
    name: 'userId',
    type: String,
    required: true,
    description: 'User ID to check access',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns whether the user can download the bundle',
    schema: {
      example: { canDownload: true },
    },
  })
  @ApiBearerAuth()
  @Auth()
  @Get('can-download')
  async canDownloadBundle(
    @Request() userDetails: UserDetails,
  ): Promise<{ canDownload: boolean }> {
    const canDownload = await this.supportBundleService.canUserDownloadBundle(
      userDetails.user.id,
    );
    return { canDownload };
  }

  @ApiOperation({ summary: 'Download a support bundle ZIP file by name' })
  @ApiParam({
    name: 'fileName',
    description: 'File name without zip extension (e.g., ndm_logs)',
  })
  @Get('download/:fileName')
  async downloadSupportBundle(
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const fullFileName = `${fileName}.zip`;
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

  // @ApiOperation({
  //   summary: 'Generate Error Logs using JobRunId or jobConfigId',
  // })
  // @ApiResponse({ status: 404, description: 'Error log file not found.' })
  // @Get('generate-error-csv/:id')
  // async generateErrorCsv(@Param('id') id: string) {
  //   return await this.supportBundleService.createCsvFileForJob(id);
  // }
}

