import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from '../entities/permission.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([Permission, User, UserRole, Project, Account]),
    AuthKeycloakModule,
  ],
  controllers: [PermissionController],
  providers: [PermissionService],
})
export class PermissionModule {}
