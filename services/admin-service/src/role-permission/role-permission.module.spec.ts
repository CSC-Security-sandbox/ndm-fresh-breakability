import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermissionModule } from './role-permission.module';
import { Role } from '../entities/role.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';

describe('RolePermissionModule', () => {
  let rolePermissionModule: RolePermissionModule;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            Role,
            User,
            UserRole,
            Project,
            Account,
            Permission,
            RolePermission,
          ],
          synchronize: false,
        }),
        RolePermissionModule,
        TypeOrmModule.forFeature([Role]),
      ],
    }).compile();

    rolePermissionModule =
      module.get<RolePermissionModule>(RolePermissionModule);
  });

  it('should be defined', () => {
    expect(rolePermissionModule).toBeDefined();
  });
});
