import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../entities/account.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Permission } from '../entities/permission.entity';
import { Project } from '../entities/project.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Project,
      User,
      Role,
      UserRole,
      Permission,
      RolePermission,
    ]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
