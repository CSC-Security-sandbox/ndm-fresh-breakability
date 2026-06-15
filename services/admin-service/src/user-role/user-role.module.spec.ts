import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { UserRoleModule } from './user-role.module';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';

describe('UserRoleModule', () => {
  let userRoleModule: UserRoleModule;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            User,
            Role,
            Project,
            Account,
            UserRole,
            Permission,
            RolePermission,
          ],
          synchronize: false,
        }),
        UserRoleModule,
        TypeOrmModule.forFeature([
          User,
          Role,
          Project,
          Account,
          UserRole,
          Permission,
          RolePermission,
        ]),
      ],
    }).compile();

    userRoleModule = module.get<UserRoleModule>(UserRoleModule);
  });

  it('should be defined', () => {
    expect(userRoleModule).toBeDefined();
  });
});
