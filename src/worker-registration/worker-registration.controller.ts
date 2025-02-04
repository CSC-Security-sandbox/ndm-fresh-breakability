import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegisterWorkerDto } from './dto/register-worker.dto';
import { WorkerRegistrationService } from './worker-registration.service';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';

@ApiTags('worker-registration')
@Controller('/api/v1/worker-registration')
export class WorkerRegistrationController {
    constructor(private readonly workerRegistrationService: WorkerRegistrationService) {}

    @Auth()
    @ApiBearerAuth()
    @Post()
    @ApiOperation({
      summary: 'Create And Registers Worker in keyloak and return client id and secret',

    })
    @ApiBody({ type: RegisterWorkerDto })
    registerWorker(@Body() registerWorkerDTO: RegisterWorkerDto) {
      return this.workerRegistrationService.registerWorker(registerWorkerDTO);
    }

}
