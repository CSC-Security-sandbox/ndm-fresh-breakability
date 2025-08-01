import typeormConfig from 'src/config/database.config';
import { DataSourceOptions } from 'typeorm';

// Mock all TypeORM decorators to prevent import errors
jest.mock('typeorm', () => ({
  ...jest.requireActual('typeorm'),
  Entity: () => (target: any) => target,
  PrimaryGeneratedColumn: () => (target: any, key: string) => {},
  Column: () => (target: any, key: string) => {},
  OneToMany: () => (target: any, key: string) => {},
  ManyToOne: () => (target: any, key: string) => {},
  JoinColumn: () => (target: any, key: string) => {},
  CreateDateColumn: () => (target: any, key: string) => {},
  UpdateDateColumn: () => (target: any, key: string) => {},
  Index: () => (target: any, key?: string) => {},
}));

// Mock only the entity classes that actually exist in support-service
jest.mock('src/entities/operation-error.entity', () => ({
  OperationErrorEntity: class MockOperationErrorEntity {},
}));

jest.mock('src/entities/worker.entity', () => ({
  WorkerEntity: class MockWorkerEntity {},
}));

// Type assertion for PostgreSQL DataSourceOptions
type PostgresDataSourceOptions = DataSourceOptions & {
  type: 'postgres';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  schema?: string;
  entities?: any[];
  migrations?: any[];
  synchronize?: boolean;
  dropSchema?: boolean;
  logging?: boolean;
};

describe('TypeORM Config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV }; // make a copy to modify
  });

  afterEach(() => {
    process.env = OLD_ENV; // restore original env
  });

  it('should return correct configuration when all environment variables are defined', () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'user';
    process.env.DB_PASSWORD = 'pass';
    process.env.DB_NAME = 'testdb';
    process.env.SCHEMA = 'public';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.type).toBe('postgres');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(5433);
    expect(config.username).toBe('user');
    expect(config.password).toBe('pass');
    expect(config.database).toBe('testdb');
    expect(config.schema).toBe('public');
    expect(config.synchronize).toBe(false);
    expect(config.dropSchema).toBe(false);
    expect(config.logging).toBe(false);
    expect(config.entities).toBeDefined();
    expect(config.entities!.length).toBeGreaterThan(0);
    expect(config.migrations).toEqual([]);
  });

  it('should default DB_PORT to 5432 if not set', () => {
    process.env.DB_HOST = 'localhost';
    delete process.env.DB_PORT;
    process.env.DB_USER = 'user';
    process.env.DB_PASSWORD = 'pass';
    process.env.DB_NAME = 'testdb';
    process.env.SCHEMA = 'myschema';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBe(5432); // default
  });

  it('should return undefined schema if process.env.SCHEMA is not set', () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USER = 'user';
    process.env.DB_PASSWORD = 'pass';
    process.env.DB_NAME = 'testdb';
    delete process.env.SCHEMA;

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.schema).toBeUndefined();
  });

  it('should handle undefined environment variables', () => {
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    delete process.env.SCHEMA;

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.host).toBeUndefined();
    expect(config.port).toBe(5432); // default
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.database).toBeUndefined();
    expect(config.schema).toBeUndefined();
  });

  it('should handle invalid port numbers', () => {
    process.env.DB_PORT = 'invalid_port';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBeNaN();
  });

  it('should handle zero port', () => {
    process.env.DB_PORT = '0';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBe(0);
  });

  it('should handle negative port', () => {
    process.env.DB_PORT = '-1';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBe(-1);
  });

  it('should handle port with whitespace', () => {
    process.env.DB_PORT = '  5433  ';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBe(5433);
  });

  it('should have correct static configuration values', () => {
    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.type).toBe('postgres');
    expect(config.synchronize).toBe(false);
    expect(config.dropSchema).toBe(false);
    expect(config.logging).toBe(false);
    expect(config.migrations).toEqual([]);
  });

  it('should include all required entities', () => {
    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.entities).toBeDefined();
    expect(Array.isArray(config.entities)).toBe(true);
    expect(config.entities!.length).toBe(2); // OperationErrorEntity and WorkerEntity
  });

  it('should have correct namespace key', () => {
    expect(typeormConfig.KEY).toBe('CONFIGURATION(typeorm)');
  });

  it('should return the same configuration when called multiple times', () => {
    process.env.DB_HOST = 'test-host';
    process.env.DB_PORT = '5432';

    const config1 = typeormConfig();
    const config2 = typeormConfig();

    expect(config1).toEqual(config2);
  });

  it('should return new object instances on each call', () => {
    const config1 = typeormConfig();
    const config2 = typeormConfig();

    expect(config1).not.toBe(config2);
  });

  it('should handle special characters in environment variables', () => {
    process.env.DB_HOST = 'host@domain.com';
    process.env.DB_USER = 'user@domain.com';
    process.env.DB_PASSWORD = 'P@ssw0rd!@#$%^&*()';
    process.env.DB_NAME = 'db-name_test';
    process.env.SCHEMA = 'schema_v1';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.host).toBe('host@domain.com');
    expect(config.username).toBe('user@domain.com');
    expect(config.password).toBe('P@ssw0rd!@#$%^&*()');
    expect(config.database).toBe('db-name_test');
    expect(config.schema).toBe('schema_v1');
  });

  it('should handle large port numbers', () => {
    process.env.DB_PORT = '65535';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.port).toBe(65535);
  });

  it('should handle boolean-like strings in environment variables', () => {
    process.env.DB_HOST = 'true';
    process.env.DB_USER = 'false';
    process.env.DB_PASSWORD = 'yes';
    process.env.DB_NAME = 'no';
    process.env.SCHEMA = '1';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.host).toBe('true');
    expect(config.username).toBe('false');
    expect(config.password).toBe('yes');
    expect(config.database).toBe('no');
    expect(config.schema).toBe('1');
  });

  it('should handle number-like strings in environment variables', () => {
    process.env.DB_HOST = '12345';
    process.env.DB_USER = '67890';
    process.env.DB_PASSWORD = '99999';
    process.env.DB_NAME = '11111';
    process.env.SCHEMA = '22222';

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.host).toBe('12345');
    expect(config.username).toBe('67890');
    expect(config.password).toBe('99999');
    expect(config.database).toBe('11111');
    expect(config.schema).toBe('22222');
  });

  it('should handle mixed environment variable scenarios', () => {
    process.env.DB_HOST = 'mixed-host.example.com';
    delete process.env.DB_PORT; // Will use default 5432
    process.env.DB_USER = 'mixed_user';
    delete process.env.DB_PASSWORD; // Will be undefined
    process.env.DB_NAME = 'mixed_database';
    delete process.env.SCHEMA; // Will be undefined

    const config = typeormConfig() as PostgresDataSourceOptions;

    expect(config.host).toBe('mixed-host.example.com');
    expect(config.port).toBe(5432);
    expect(config.username).toBe('mixed_user');
    expect(config.password).toBeUndefined();
    expect(config.database).toBe('mixed_database');
    expect(config.schema).toBeUndefined();
  });

  describe('Additional Edge Cases', () => {
    it('should handle floating point port numbers', () => {
      process.env.DB_PORT = '5432.99';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.port).toBe(5432.99);
    });

    it('should handle extremely large port numbers', () => {
      process.env.DB_PORT = '999999999';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.port).toBe(999999999);
    });

    it('should handle empty string for all environment variables', () => {
      process.env.DB_HOST = '';
      process.env.DB_PORT = '';
      process.env.DB_USER = '';
      process.env.DB_PASSWORD = '';
      process.env.DB_NAME = '';
      process.env.SCHEMA = '';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe('');
      expect(config.port).toBe(0); // Empty string converts to 0, not default
      expect(config.username).toBe('');
      expect(config.password).toBe('');
      expect(config.database).toBe('');
      expect(config.schema).toBe('');
    });

    it('should handle unicode and international characters', () => {
      process.env.DB_HOST = 'τεστ.εξάμπλε.γρ';
      process.env.DB_USER = 'пользователь';
      process.env.DB_PASSWORD = 'パスワード123';
      process.env.DB_NAME = 'base_données';
      process.env.SCHEMA = 'स्कीमा';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe('τεστ.εξάμπλε.γρ');
      expect(config.username).toBe('пользователь');
      expect(config.password).toBe('パスワード123');
      expect(config.database).toBe('base_données');
      expect(config.schema).toBe('स्कीमा');
    });

    it('should handle environment variables with newlines and tabs', () => {
      process.env.DB_HOST = 'host\nwith\nnewlines';
      process.env.DB_USER = 'user\twith\ttabs';
      process.env.DB_PASSWORD = 'pass\r\nwith\r\ncrlf';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe('host\nwith\nnewlines');
      expect(config.username).toBe('user\twith\ttabs');
      expect(config.password).toBe('pass\r\nwith\r\ncrlf');
    });

    it('should handle JSON-like strings in environment variables', () => {
      process.env.DB_HOST = '{"host": "localhost"}';
      process.env.DB_USER = '[1,2,3,4,5]';
      process.env.DB_PASSWORD = '{"password": "secret"}';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe('{"host": "localhost"}');
      expect(config.username).toBe('[1,2,3,4,5]');
      expect(config.password).toBe('{"password": "secret"}');
    });

    it('should handle SQL injection-like strings safely', () => {
      process.env.DB_HOST = "'; DROP TABLE users; --";
      process.env.DB_USER = "admin' OR '1'='1";
      process.env.DB_PASSWORD = "'; SELECT * FROM passwords; --";

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe("'; DROP TABLE users; --");
      expect(config.username).toBe("admin' OR '1'='1");
      expect(config.password).toBe("'; SELECT * FROM passwords; --");
    });

    it('should handle environment variables with escape sequences', () => {
      process.env.DB_HOST = 'host\\nwith\\tescapes\\r';
      process.env.DB_USER = 'user\\\\with\\backslashes';
      process.env.DB_PASSWORD = 'pass\\"with\\"quotes';

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe('host\\nwith\\tescapes\\r');
      expect(config.username).toBe('user\\\\with\\backslashes');
      expect(config.password).toBe('pass\\"with\\"quotes');
    });

    it('should handle very long environment variable values', () => {
      const longHost = 'a'.repeat(1000);
      const longUser = 'b'.repeat(500);
      const longPassword = 'c'.repeat(2000);

      process.env.DB_HOST = longHost;
      process.env.DB_USER = longUser;
      process.env.DB_PASSWORD = longPassword;

      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.host).toBe(longHost);
      expect(config.username).toBe(longUser);
      expect(config.password).toBe(longPassword);
      expect(config.host!.length).toBe(1000);
      expect(config.username!.length).toBe(500);
      expect(config.password!.length).toBe(2000);
    });

    it('should maintain configuration consistency across multiple calls with changing environment', () => {
      process.env.DB_HOST = 'initial';
      const result1 = typeormConfig() as PostgresDataSourceOptions;

      process.env.DB_HOST = 'changed';
      const result2 = typeormConfig() as PostgresDataSourceOptions;

      // Each call should reflect the current environment
      expect(result1.host).toBe('initial');
      expect(result2.host).toBe('changed');
    });

    it('should handle port value edge cases with coercion', () => {
      // Test various string coercions that result in valid numbers
      const testCases = [
        { input: '0x1F90', expected: 8080 }, // Hexadecimal
        { input: '1e3', expected: 1000 }, // Scientific notation
        { input: '+5432', expected: 5432 }, // Positive sign
        { input: '5432.0', expected: 5432 }, // Decimal zero
      ];

      testCases.forEach(({ input, expected }) => {
        process.env.DB_PORT = input;
        const config = typeormConfig() as PostgresDataSourceOptions;
        expect(config.port).toBe(expected);
      });
    });

    it('should verify all configuration properties are present', () => {
      const config = typeormConfig() as PostgresDataSourceOptions;

      // Verify all expected properties exist (even if undefined)
      expect(config).toHaveProperty('type');
      expect(config).toHaveProperty('host');
      expect(config).toHaveProperty('port');
      expect(config).toHaveProperty('username');
      expect(config).toHaveProperty('password');
      expect(config).toHaveProperty('database');
      expect(config).toHaveProperty('synchronize');
      expect(config).toHaveProperty('dropSchema');
      expect(config).toHaveProperty('logging');
      expect(config).toHaveProperty('schema');
      expect(config).toHaveProperty('entities');
      expect(config).toHaveProperty('migrations');
    });

    it('should ensure entities array contains correct entity classes', () => {
      const config = typeormConfig() as PostgresDataSourceOptions;

      expect(config.entities).toBeDefined();
      expect(Array.isArray(config.entities)).toBe(true);
      expect(config.entities!.length).toBe(2);
      // Check that entities are functions (classes)
      expect(typeof config.entities![0]).toBe('function');
      expect(typeof config.entities![1]).toBe('function');
    });
  });
});
