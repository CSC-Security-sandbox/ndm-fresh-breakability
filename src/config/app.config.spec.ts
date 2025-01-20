import appConfig from "./app.config";

describe('Worker Config', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const clearEnvVars = () => {
    delete process.env.FILE_SERVICE_BASEURL;
    delete process.env.JOB_SERVICE_BASEURL;
    delete process.env.SOCKET_SERVER;
  };

  it('should return default values when no environment variables are set', () => {
    clearEnvVars();
    const config = appConfig();
    expect(config).toEqual({
      fileServiceBaseURL: undefined,
      jobServiceBaseURL: undefined,
      socketServer: '',
    });
  });

  it('should use environment variables if they are set', () => {
    process.env.FILE_SERVICE_BASEURL = 'http://fileservice.example.com';
    process.env.JOB_SERVICE_BASEURL = 'http://jobservice.example.com';
    process.env.SOCKET_SERVER = 'http://socketserver.example.com';
    const config = appConfig();
    expect(config).toEqual({
      fileServiceBaseURL: 'http://fileservice.example.com',
      jobServiceBaseURL: 'http://jobservice.example.com',
      socketServer: 'http://socketserver.example.com',
    });
  });

  it('should handle missing and partially set environment variables', () => {
    clearEnvVars();
    process.env.FILE_SERVICE_BASEURL = 'http://fileservice.example.com';
    const config = appConfig();
    expect(config).toEqual({
      fileServiceBaseURL: 'http://fileservice.example.com',
      jobServiceBaseURL: undefined,
      socketServer: '',
    });
  });
});
