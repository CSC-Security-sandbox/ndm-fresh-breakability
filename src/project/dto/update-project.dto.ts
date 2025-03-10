import { OmitType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends OmitType(CreateProjectDto, ['account_id'] as const) {}
