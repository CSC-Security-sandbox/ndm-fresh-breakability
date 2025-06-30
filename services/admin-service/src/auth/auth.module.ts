import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { Permission } from '../entities/permission.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserRole,
      Role,
      Project,
      Account,
      RolePermission,
      Permission,
    ]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
