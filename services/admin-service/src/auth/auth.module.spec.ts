import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth.module';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { User } from '../entities/user.entity';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { Permission } from '../entities/permission.entity';

describe('AuthModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            User,
            UserRole,
            Role,
            Project,
            Account,
            RolePermission,
            Permission,
          ],
          synchronize: false,
        }),
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
        AuthModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should have AuthModule', () => {
    expect(module.get(AuthModule)).toBeDefined();
  });
});
