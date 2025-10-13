import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AboutNdmService } from './about-ndm.service';
import { AboutNdmResponse } from './about-ndm.interface';
import { AboutNdmResponseSchema } from './about-ndm.schema';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';

@ApiTags('about-ndm')
@Controller('/api/v1/about-ndm')
export class AboutNdmController {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly buildVersionService: AboutNdmService,
  ) {
    this.logger = loggerFactory.create(AboutNdmController.name);
  }

  @Auth()
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get NDM product and build information from Prometheus',
  })
  @ApiResponse({
    status: 200,
    description: 'NDM product and build information retrieved successfully',
    type: AboutNdmResponseSchema,
  })
  async getBuildVersion(): Promise<AboutNdmResponse> {
    this.logger.log('Getting NDM product and build information');
    return this.buildVersionService.getAboutNdm();
  }
}
