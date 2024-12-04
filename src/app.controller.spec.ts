import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { Permission } from './entities/permission.entity';
import { Project } from './entities/project.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';

describe('AppController', () => {
  let controller: AppController;
  // let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Permission),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(RolePermission),
          useClass: Repository,
        },
        { provide: getRepositoryToken(User), useClass: Repository },
        { provide: getRepositoryToken(Role), useClass: Repository },
        { provide: getRepositoryToken(Project), useClass: Repository },
        { provide: getRepositoryToken(Account), useClass: Repository },
        { provide: getRepositoryToken(UserRole), useClass: Repository },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
    // service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have getHealthCheck', () => {
    expect(controller.getHealthCheck).toBeDefined();
  });

  it('should return "Admin Service is Running!"', () => {
    expect(controller.getHealthCheck()).toBe('Admin Service is Running!');
  });
});
