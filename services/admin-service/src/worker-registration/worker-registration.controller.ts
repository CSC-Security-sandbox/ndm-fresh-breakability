import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  RegisterWorkerDto,
  RegisterWorkerResponseDto,
} from './dto/register-worker.dto';
import { WorkerRegistrationService } from './worker-registration.service';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';

@ApiTags('worker-registration')
@Controller('/api/v1/worker-registration')
export class WorkerRegistrationController {
  constructor(
    private readonly workerRegistrationService: WorkerRegistrationService,
  ) {}

  @Auth(Permission.WorkerDeployment)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary:
      'Create And Registers Worker in keyloak and return client id and secret',
  })
  @ApiBody({ type: RegisterWorkerDto })
  @ApiResponse({ type: RegisterWorkerResponseDto, status: '2XX' })
  registerWorker(@Body() registerWorkerDTO: RegisterWorkerDto) {
    return this.workerRegistrationService.registerWorker(registerWorkerDTO);
  }
}
