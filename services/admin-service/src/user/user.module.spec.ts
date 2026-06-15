import { Test, TestingModule } from '@nestjs/testing';
import { UserModule } from './user.module';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../entities/account.entity';
import { Permission } from '../entities/permission.entity';
import { Project } from '../entities/project.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';

describe('UserModule', () => {
  let userModule: UserModule;

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
        UserModule,
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

    userModule = module.get<UserModule>(UserModule);
  });

  it('should be defined', () => {
    expect(userModule).toBeDefined();
  });

  it('should have UserController', () => {
    const controllers = Reflect.getMetadata('controllers', UserModule);
    expect(controllers).toContain(UserController);
  });

  it('should have UserService', () => {
    const providers = Reflect.getMetadata('providers', UserModule);
    expect(providers).toContain(UserService);
  });
});
