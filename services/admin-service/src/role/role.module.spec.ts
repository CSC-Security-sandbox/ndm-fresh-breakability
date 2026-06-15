import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleModule } from './role.module';
import { Role } from '../entities/role.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';

describe('RoleModule', () => {
  let roleModule: RoleModule;

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
        RoleModule,
        TypeOrmModule.forFeature([Role]),
      ],
    }).compile();

    roleModule = module.get<RoleModule>(RoleModule);
  });

  it('should be defined', () => {
    expect(roleModule).toBeDefined();
  });
});
