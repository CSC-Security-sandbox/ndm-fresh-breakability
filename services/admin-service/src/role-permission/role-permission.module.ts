import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermission } from '../entities/role-permission.entity';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermissionService } from './role-permission.service';
import { RolePermissionController } from './role-permission.controller';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      Permission,
      RolePermission,
      User,
      UserRole,
      Project,
      Account,
    ]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  providers: [RolePermissionService],
  controllers: [RolePermissionController],
})
export class RolePermissionModule {}
