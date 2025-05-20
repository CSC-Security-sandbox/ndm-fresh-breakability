import { Test, TestingModule } from "@nestjs/testing";
import temporalConfig from "./temporal.config";

describe("temporalConfig", () => {
  let config: Record<string, any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: "ConfigService",
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "temporal") {
                return temporalConfig();
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    const configService = module.get("ConfigService");
    config = configService.get("temporal");
  });

  it("should return default address if TEMPORAL_ADDRESS is not set", () => {
    expect(config.address).toBe("localhost:7233");
  });

  it("should return address from environment variable if TEMPORAL_ADDRESS is set", () => {
    process.env.TEMPORAL_ADDRESS = "custom:7233";
    const customConfig = temporalConfig();
    expect(customConfig.address).toBe("custom:7233");
    delete process.env.TEMPORAL_ADDRESS;
  });
});
