import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleService } from './user-role.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserRole } from '../entities/user-role.entity';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { first, last } from 'rxjs';

describe('UserRoleService', () => {
  let service: UserRoleService;
  let userRepository: Repository<User>;
  let roleRepository: Repository<Role>;
  let projectRepository: Repository<Project>;
  let accountRepository: Repository<Account>;
  let userRoleRepository: Repository<UserRole>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRoleService,
        { provide: getRepositoryToken(User), useClass: Repository },
        { provide: getRepositoryToken(Role), useClass: Repository },
        { provide: getRepositoryToken(Project), useClass: Repository },
        { provide: getRepositoryToken(Account), useClass: Repository },
        { provide: getRepositoryToken(UserRole), useClass: Repository },
      ],
    }).compile();

    service = module.get<UserRoleService>(UserRoleService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    projectRepository = module.get<Repository<Project>>(
      getRepositoryToken(Project),
    );
    accountRepository = module.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    userRoleRepository = module.get<Repository<UserRole>>(
      getRepositoryToken(UserRole),
    );
  });

  it('should create a user role', async () => {
    const baseAtts = {
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn(),
    };

    const createUserRoleDto: CreateUserRoleDto = {
      user_id: '1',
      role_id: '1',
      account_id: '1',
      project_id: '1',
    };
    const mockUser: User = {
      id: '1',
      user_roles: [],
      email: 'Test User',
      user_status: 'active',
      ...baseAtts,
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      first_name: 'Test',
      last_name: 'User',
      name: 'Test User',
    };
    const mockRole: Role = {
      id: '1',
      role_name: 'Admin',
      role_status: 'active',
      user_roles: [],
      role_permissions: [],
      ...baseAtts,
    };
    const mockAccount: Account = {
      id: '1',
      account_name: '',
      user_roles: [],
      projects: [],
      ...baseAtts,
    };
    const mockProject: Project = {
      id: '1',
      account: mockAccount,
      user_roles: [],
      project_name: 'Test Project',
      start_date: new Date(),
      ...baseAtts,
      project_description: 'Test Project'
    };

    const userRole = {
      id: '1',
      user: mockUser,
      role: mockRole,
      account: mockAccount,
      project: mockProject,
      ...createUserRoleDto,
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      populateWhoColumns: jest.fn(),
      projectId: '1',
      accountId: '1',
      roleId: '1',
      userId: '1',
      
    } as UserRole;

    jest
      .spyOn(userRepository, 'findOneBy')
      .mockResolvedValue({ id: '1' } as User);
    jest
      .spyOn(roleRepository, 'findOneBy')
      .mockResolvedValue({ id: '1' } as Role);
    jest
      .spyOn(accountRepository, 'findOneBy')
      .mockResolvedValue({ id: '1' } as Account);
    jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(mockProject); 
    jest.spyOn(userRoleRepository, 'create').mockReturnValue(userRole);
    jest.spyOn(userRoleRepository, 'save').mockResolvedValue(userRole);

    expect(await service.create(createUserRoleDto)).toEqual(userRole);
    expect(userRoleRepository.create).toHaveBeenCalledWith(expect.any(Object));
    expect(userRoleRepository.save).toHaveBeenCalledWith(userRole);
  });

  it('should find one user role by id', async () => {
    const userRole = {
      id: '1',
      user_id: '1',
      role_id: '1',
      account_id: '1',
    } as any;

    jest.spyOn(userRoleRepository, 'findOne').mockResolvedValue(userRole);

    expect(await service.findOne('1')).toEqual(userRole);

    expect(userRoleRepository.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['user', 'role', 'project', 'account'],
    });
  });

  it('should delete a user role', async () => {
    jest
      .spyOn(userRoleRepository, 'delete')
      .mockResolvedValue({ affected: 1 } as any);

    await service.delete('1');
    expect(userRoleRepository.delete).toHaveBeenCalledWith('1');
  });

  it('should find one user role by id', async () => {
    const userRole = {
      id: '1',
      user_id: '1',
      role_id: '1',
      account_id: '1',
    } as any;

    jest.spyOn(userRoleRepository, 'findOne').mockResolvedValue(userRole);

    expect(await service.findOne('1')).toEqual(userRole);

    expect(userRoleRepository.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['user', 'role', 'project', 'account'],
    });
  });

  it('should find all user roles', async () => {
    const baseAtts = {
      created_at: new Date(),
      updated_at: new Date(),
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn().mockImplementation(function () {
        this.created_by = undefined;
        this.updated_by = undefined;
      }),
    };

    const user = {
      id: '1',
      email: 'test@test.com',
      user_status: 'active',
      created_by: undefined,
      updated_by: undefined,
      ...baseAtts,
      first_name: 'Test',
      last_name: 'User',
      name: 'Test User',
    };
    const role = {
      id: '1',
      role_name:"",
      role_status:"",
      role_permissions:[],
      created_by: undefined,
      updated_by: undefined,
      ...baseAtts,
    } as Role;
    const account = {
      id: '1',
      created_by: undefined,
      updated_by: undefined,
      ...baseAtts,
    };

    const user_roles = [
      {
        id: '1',
        user_id: '1',
        role_id: '1',
        account_id: '1',
        user: user,
        role: role,
        account: account,
        ...baseAtts,
      } as any,
      {
        id: '1',
        user_id: '1',
        role_id: '1',
        account_id: '1',
        user: user,
        role: role,
        account: account,
        ...baseAtts,
      } as any,
    ];

    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
    jest.spyOn(userRepository, 'findBy').mockResolvedValue([user]);

    user_roles.forEach((userRole) => userRole.populateWhoColumns());

    expect(await service.findAll(1, 10, 'id', 'ASC', {})).toBeDefined();
  });

  it('should find all user roles with no filters', async () => {
    const user_roles = [
      {
        id: '1',
        userId: '1',
        roleId: '1',
        accountId: '1',
        user: { id: '1', email: 'test@test.com' },
        role: { id: '1', role_name: 'Admin' },
        account: { id: '1' },
      } as UserRole,
    ];
  
    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
  
    const result = await service.findAll(1, 10, 'id', 'ASC', {});
  
    expect(result).toEqual(user_roles);
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      order: { id: 'ASC' },
      where: {},
      relations: ['user', 'role', 'project', 'account'],
    });
  });
  
  it('should filter by user_id', async () => {
    const user_roles = [
      {
        id: '1',
        userId: '1',
        roleId: '1',
        accountId: '1',
        user: { id: '1', email: 'test@test.com' },
        role: { id: '1', role_name: 'Admin' },
        account: { id: '1' },
      } as UserRole,
    ];
  
    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
  
    const result = await service.findAll(1, 10, 'id', 'ASC', { user_id: '1' });
  
    expect(result).toEqual(user_roles);
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      order: { id: 'ASC' },
      where: { user: { id: '1' } },
      relations: ['user', 'role', 'project', 'account'],
    });
  });
  
  it('should filter by role_id', async () => {
    const user_roles = [
      {
        id: '1',
        userId: '1',
        roleId: '1',
        accountId: '1',
        user: { id: '1', email: 'test@test.com' },
        role: { id: '1', role_name: 'Admin' },
        account: { id: '1' },
      } as UserRole,
    ];
  
    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
  
    const result = await service.findAll(1, 10, 'id', 'ASC', { role_id: '1' });
  
    expect(result).toEqual(user_roles);
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      order: { id: 'ASC' },
      where: { role: { id: '1' } },
      relations: ['user', 'role', 'project', 'account'],
    });
  });
  
  it('should filter by project_id', async () => {
    const user_roles = [
      {
        id: '1',
        userId: '1',
        roleId: '1',
        accountId: '1',
        user: { id: '1', email: 'test@test.com' },
        role: { id: '1', role_name: 'Admin' },
        account: { id: '1' },
      } as UserRole,
    ];
  
    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
  
    const result = await service.findAll(1, 10, 'id', 'ASC', { project_id: '1' });
  
    expect(result).toEqual(user_roles);
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      order: { id: 'ASC' },
      where: { project: { id: '1' } },
      relations: ['user', 'role', 'project', 'account'],
    });
  });
  
  it('should filter by account_id', async () => {
    const user_roles = [
      {
        id: '1',
        userId: '1',
        roleId: '1',
        accountId: '1',
        user: { id: '1', email: 'test@test.com' },
        role: { id: '1', role_name: 'Admin' },
        account: { id: '1' },
      } as UserRole,
    ];
  
    jest.spyOn(userRoleRepository, 'find').mockResolvedValue(user_roles);
  
    const result = await service.findAll(1, 10, 'id', 'ASC', { account_id: '1' });
  
    expect(result).toEqual(user_roles);
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      skip: 0,
      take: 10,
      order: { id: 'ASC' },
      where: { account: { id: '1' } },
      relations: ['user', 'role', 'project', 'account'],
    });
  });

  describe('create', () => {
    it('should create a new user role', async () => {
      const createUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;
      const account = { id: 'account-id' } as Account;

      const userRole = new UserRole();
      userRole.id = 'user-role-id';
      userRole.user = user;
      userRole.role = role;
      userRole.project = project;
      userRole.account = account;
      userRole.populateWhoColumns = jest.fn();

      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(userRoleRepository, 'create').mockReturnValue(userRole);
      jest.spyOn(userRoleRepository, 'save').mockResolvedValue(userRole);

      const result = await service.create(createUserRoleDto);
      expect(result).toEqual(userRole);
    });

    it('should throw NotFoundException if user not found', async () => {
      const createUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(null);

      await expect(service.create(createUserRoleDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if account not found', async () => {
      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;

      const createUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);

      await expect(service.create(createUserRoleDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create even if project not found', async () => {
      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;
      const account = { id: 'account-id' } as Account;

      const createUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(null);

      const userRole = new UserRole();
      userRole.id = 'user-role-id';
      userRole.user = user;
      userRole.role = role;
      userRole.project = project;
      userRole.account = account;
      userRole.populateWhoColumns = jest.fn();

      jest.spyOn(userRoleRepository, 'create').mockReturnValue(userRole);
      jest.spyOn(userRoleRepository, 'save').mockResolvedValue(userRole);

      const result = await service.create(createUserRoleDto);
      expect(result).toEqual(userRole);
    });

    it('should throw NotFoundException if role not found', async () => {
      const user = { id: 'user-id' } as User;
      const project = { id: 'project-id' } as Project;
      const account = { id: 'account-id' } as Account;

      const createUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);

      await expect(service.create(createUserRoleDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an existing user role', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      const userRole = new UserRole();
      userRole.id = 'user-role-id';
      userRole.user = { id: 'user-id' } as User;
      userRole.role = { id: 'role-id' } as Role;
      userRole.project = { id: 'project-id' } as Project;
      userRole.account = { id: 'account-id' } as Account;
      userRole.populateWhoColumns = jest.fn();

      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;
      const account = { id: 'account-id' } as Account;

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(userRole);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(userRoleRepository, 'save').mockResolvedValue(userRole);

      await service.update('user-role-id', updateUserRoleDto);

      expect(userRoleRepository.save).toHaveBeenCalledWith(userRole);
    });

    it('should throw NotFoundException if user role not found', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.update('user-role-id', updateUserRoleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if user not found', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };
      const userRole = { id: 'user-role-id' } as UserRole;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;
      const account = { id: 'account-id' } as Account;

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(userRole);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);

      await expect(
        service.update('user-role-id', updateUserRoleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if account not found', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };
      const userRole = { id: 'user-role-id' } as UserRole;
      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const project = { id: 'project-id' } as Project;

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(userRole);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.update('user-role-id', updateUserRoleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if role not found', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: 'project-id',
        account_id: 'account-id',
      };
      const userRole = { id: 'user-role-id' } as UserRole;
      const user = { id: 'user-id' } as User;
      const account = { id: 'account-id' } as Account;
      const project = { id: 'project-id' } as Project;

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(userRole);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(project);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);

      await expect(
        service.update('user-role-id', updateUserRoleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update an existing user role even if project is not found', async () => {
      const updateUserRoleDto = {
        user_id: 'user-id',
        role_id: 'role-id',
        project_id: null,
        account_id: 'account-id',
      };

      const userRole = new UserRole();
      userRole.id = 'user-role-id';
      userRole.user = { id: 'user-id' } as User; 
      userRole.role = { id: 'role-id' } as Role;
      userRole.project = null; 
      userRole.account = { id: 'account-id' } as Account;
      userRole.populateWhoColumns = jest.fn();

      const user = { id: 'user-id' } as User;
      const role = { id: 'role-id' } as Role;
      const account = { id: 'account-id' } as Account;

      jest.spyOn(userRoleRepository, 'findOneBy').mockResolvedValue(userRole);
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValue(account);
      jest.spyOn(userRoleRepository, 'save').mockResolvedValue(userRole);

      await service.update('user-role-id', updateUserRoleDto);

      expect(userRoleRepository.save).toHaveBeenCalledWith(userRole);
    });
  });

  describe('delete', () => {
    it('should delete an existing user role', async () => {
      jest
        .spyOn(userRoleRepository, 'delete')
        .mockResolvedValue({ affected: 1 } as any);

      await service.delete('user-role-id');

      expect(userRoleRepository.delete).toHaveBeenCalledWith('user-role-id');
    });

    it('should throw NotFoundException if user role not found', async () => {
      jest
        .spyOn(userRoleRepository, 'delete')
        .mockResolvedValue({ affected: 0 } as any);

      await expect(service.delete('user-role-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('should return a user role', async () => {
      const userRole = { id: 'user-role-id' } as UserRole;

      jest.spyOn(userRoleRepository, 'findOne').mockResolvedValue(userRole);

      const result = await service.findOne('user-role-id');

      expect(result).toEqual(userRole);
    });

    it('should throw NotFoundException if user role not found', async () => {
      jest.spyOn(userRoleRepository, 'findOne').mockResolvedValue(null);

      await expect(service.findOne('user-role-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
