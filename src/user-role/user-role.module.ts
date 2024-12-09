import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserRoleService } from './user-role.service';
import { UserRoleController } from './user-role.controller';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Project, Account, UserRole]), AuthKeycloakModule],
  providers: [UserRoleService],
  controllers: [UserRoleController],
})
export class UserRoleModule {}
