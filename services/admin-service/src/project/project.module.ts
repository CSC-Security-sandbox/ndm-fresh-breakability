import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { User } from '../entities/user.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { UserRole } from '../entities/user-role.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Account, User, UserRole]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
})
export class ProjectModule {}
