import { Module } from '@nestjs/common';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [TypeOrmModule.forFeature([Role]), AuthKeycloakModule],
  controllers: [RoleController],
  providers: [RoleService],
})
export class RoleModule {}
