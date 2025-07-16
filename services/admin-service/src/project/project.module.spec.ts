import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from './project.module';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory, mockLoggerService } from '../test-utils/logger-mocks';

describe('ProjectModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    // Environment variables are already set in test-setup.ts
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [
            Account,
            Project,
            UserRole,
            User,
            Role,
            Permission,
            RolePermission,
          ],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Project,
          Account,
          UserRole,
          User,
          Role,
          Permission,
          RolePermission,
        ]),
        ProjectModule,
      ],
    })
    .overrideProvider(LoggerFactory)
    .useValue(mockLoggerFactory)
    .overrideProvider(LoggerService)
    .useValue(mockLoggerService)
    .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should have account module', () => {
    expect(module.get(ProjectModule)).toBeDefined();
  });
});
