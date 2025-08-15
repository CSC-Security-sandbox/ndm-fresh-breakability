import temporalConfig from './temporal.config';

describe('temporalConfig', () => {
  it('should return the default Temporal address when environment variable is not set', () => {

    const originalAddress = process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_ADDRESS;
    const config = temporalConfig();
    expect(config.address).toBe('localhost:8233');
    process.env.TEMPORAL_ADDRESS = originalAddress;
  });

  it('should return the Temporal address from environment variable when set', () => {
    process.env.TEMPORAL_ADDRESS = 'custom-temporal-address:7233';
    const config = temporalConfig();
    expect(config.address).toBe('custom-temporal-address:7233');
    delete process.env.TEMPORAL_ADDRESS;
  });
});
