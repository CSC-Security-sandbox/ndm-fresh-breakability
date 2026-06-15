import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { Test, TestingModule } from '@nestjs/testing';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionModule } from './permission.module';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';

describe('PermissionModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            Role,
            Permission,
            RolePermission,
            User,
            UserRole,
            Project,
            Account,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Role,
          Permission,
          RolePermission,
          User,
          UserRole,
          Project,
          Account,
        ]),
        PermissionModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should have account module', () => {
    expect(module.get(PermissionModule)).toBeDefined();
  });
});
