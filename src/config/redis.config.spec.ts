import { ConfigObject } from "@nestjs/config";
import redisConfig from "./redis.config";

describe("redisConfig", () => {
  it("should return the default redis URL when REDIS_URL is not set", () => {
    const config: ConfigObject = redisConfig();
    expect(config.url).toBe("redis:6379");
  });

  it("should return the redis URL from environment variable when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://custom:6379";
    const config: ConfigObject = redisConfig();
    expect(config.url).toBe("redis://custom:6379");
    delete process.env.REDIS_URL; // Clean up
  });
});
