import {
  Controller,
  Post,
  Body,
  Request,
  Headers,
  Get,
  Param,
  Res,
  NotFoundException,
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

@Controller('support-bundle')
export class SupportBundleController {
  constructor(private readonly supportBundleService: SupportBundleService) {}

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
    @Headers('traceId') traceId: string,
    @Request() userDetails: UserDetails,
  ) {
    return this.supportBundleService.create(
      createSupportBundleDTO,
      traceId,
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
}
