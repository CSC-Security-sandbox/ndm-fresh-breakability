import { OmitType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';
import { PartialType } from '@nestjs/swagger';

export class UpdateProjectDto extends PartialType(OmitType(CreateProjectDto, ['account_id'] as const)) {}
