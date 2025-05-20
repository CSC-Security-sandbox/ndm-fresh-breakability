import workerRegisterConfig, {
  WorkerRegisterConfig,
} from './workerregister.config';

describe('Worker Register Configuration', () => {
  beforeEach(() => {
    delete process.env.CONTROL_PLANE_IP;
  });

  it('should return default config when environment variable is not set', () => {
    const config: WorkerRegisterConfig = workerRegisterConfig();
    expect(config.controlPlaneIp).toBe('localhost');
  });

  it('should return custom config when environment variable is set', () => {
    process.env.CONTROL_PLANE_IP = '192.168.1.1';
    const config: WorkerRegisterConfig = workerRegisterConfig();
    expect(config.controlPlaneIp).toBe('192.168.1.1');
  });
});
