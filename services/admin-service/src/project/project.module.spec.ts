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
import { NonEmptyStringPipe } from 'src/utils/pipes/non-empty-string';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

describe('ProjectModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
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
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should have account module', () => {
    expect(module.get(ProjectModule)).toBeDefined();
  });
  it('should have ProjectController', () => {
    const controller = module.get(ProjectController);
    expect(controller).toBeInstanceOf(ProjectController);
  });

  it('should have ProjectService', () => {
    const service = module.get(ProjectService);
    expect(service).toBeInstanceOf(ProjectService);
  });

  it('should have NonEmptyStringPipe', () => {
    const pipe = module.get(NonEmptyStringPipe);
    expect(pipe).toBeInstanceOf(NonEmptyStringPipe);
  });
});