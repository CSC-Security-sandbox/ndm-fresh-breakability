import { Test, TestingModule } from "@nestjs/testing";
import databaseConfig from "./database.config";

describe("DatabaseConfig", () => {
  let config;

  beforeAll(() => {
    process.env.DB_HOST = "localhost";
    process.env.DB_PORT = "5432";
    process.env.DB_USER = "testuser";
    process.env.DB_PASSWORD = "testpassword";
    process.env.DB_NAME = "testdb";
    process.env.DB_SCHEMA = "public";
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: "typeorm",
          useFactory: databaseConfig,
        },
      ],
    }).compile();

    config = module.get("typeorm");
  });

  it("should be defined", () => {
    expect(config).toBeDefined();
  });

  it("should have correct type", () => {
    expect(config.type).toBe("postgres");
  });

  it("should have correct host", () => {
    expect(config.host).toBe("localhost");
  });

  it("should have correct port", () => {
    expect(config.port).toBe(5432);
  });

  it("should have correct username", () => {
    expect(config.username).toBe("testuser");
  });

  it("should have correct password", () => {
    expect(config.password).toBe("testpassword");
  });

  it("should have correct database name", () => {
    expect(config.database).toBe("testdb");
  });

  it("should have correct schema", () => {
    expect(config.schema).toBe("public");
  });

  it("should have correct entities", () => {
    expect(config.entities).toEqual([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it("should have synchronize set to false", () => {
    expect(config.synchronize).toBe(false);
  });

  it("should have dropSchema set to false", () => {
    expect(config.dropSchema).toBe(false);
  });

  it("should have logging set to false", () => {
    expect(config.logging).toBe(false);
  });

  it("should have ssl set to false", () => {
    expect(config.ssl).toBe(false);
  });

  it("should have empty migrations array", () => {
    expect(config.migrations).toEqual([]);
  });
});
