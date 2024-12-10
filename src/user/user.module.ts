import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserRole, Role, Project, Account, RolePermission]), AuthKeycloakModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}