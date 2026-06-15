import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from './account.module';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Permission } from '../entities/permission.entity';

describe('AccountModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            Account,
            Project,
            User,
            Role,
            UserRole,
            RolePermission,
            Permission,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Account,
          Project,
          User,
          Role,
          UserRole,
          Permission,
          RolePermission,
        ]),
        AccountModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should have account module', () => {
    expect(module.get(AccountModule)).toBeDefined();
  });
});
