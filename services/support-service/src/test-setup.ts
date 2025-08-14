// Mock TypeORM to avoid module resolution issues
jest.mock('typeorm', () => ({
  Entity: () => (target: any) => target,
  PrimaryGeneratedColumn: () => (target: any, propertyKey: string) => {},
  PrimaryColumn: () => (target: any, propertyKey: string) => {},
  Column: () => (target: any, propertyKey: string) => {},
  CreateDateColumn: () => (target: any, propertyKey: string) => {},
  UpdateDateColumn: () => (target: any, propertyKey: string) => {},
  ManyToOne: () => (target: any, propertyKey: string) => {},
  OneToMany: () => (target: any, propertyKey: string) => {},
  OneToOne: () => (target: any, propertyKey: string) => {},
  ManyToMany: () => (target: any, propertyKey: string) => {},
  JoinColumn: () => (target: any, propertyKey: string) => {},
  JoinTable: () => (target: any, propertyKey: string) => {},
  Repository: class Repository {},
  getRepository: jest.fn(),
  createConnection: jest.fn(),
  getConnection: jest.fn(),
  getManager: jest.fn(),
  DataSource: class DataSource {},
  In: jest.fn(),
  Like: jest.fn(),
  Between: jest.fn(),
  MoreThan: jest.fn(),
  LessThan: jest.fn(),
  IsNull: jest.fn(),
  Not: jest.fn(),
}));

// Mock @nestjs/typeorm
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository:
    () =>
    (
      target: any,
      propertyKey: string | symbol | undefined,
      parameterIndex: number,
    ) => {},
  TypeOrmModule: {
    forRoot: jest.fn(),
    forFeature: jest.fn(),
  },
  getRepositoryToken: jest.fn(() => 'mock-repository-token'),
}));

// Disable console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
