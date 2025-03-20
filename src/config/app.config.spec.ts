import { Test, TestingModule } from "@nestjs/testing";
import appConfig from "./app.config";

describe("AppConfig", () => {
  let config: Record<string, any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: "app",
          useFactory: appConfig,
        },
      ],
    }).compile();

    config = module.get<Record<string, any>>("app");
  });

  it("should have default host as 0.0.0.0", () => {
    expect(config.http.host).toBe("0.0.0.0");
  });

  it("should have default port as 3000", () => {
    expect(config.http.port).toBe(3000);
  });

  it("should use environment variables for host and port", () => {
    process.env.APP_HOST = "127.0.0.1";
    process.env.APP_PORT = "4000";

    const newConfig = appConfig();

    expect(newConfig.http.host).toBe("127.0.0.1");
    expect(newConfig.http.port).toBe(4000);
  });
});
