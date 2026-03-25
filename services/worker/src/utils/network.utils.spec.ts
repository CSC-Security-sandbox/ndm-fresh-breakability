import { networkInterfaces } from 'os';
import { getLocalIpAddress, configureSmbAdDns } from './network.utils';

jest.mock('os');

// execAsync is built via promisify(exec) at module load time.
// Use a module-scoped mock that jest.mock can capture via the factory closure.
// jest.fn() in the factory is hoisted safely; we retrieve it from the mocked module.
jest.mock('util', () => {
  const actualUtil = jest.requireActual('util');
  const mockFn = jest.fn();
  return {
    ...actualUtil,
    promisify: jest.fn(() => mockFn),
    __mockExecAsync: mockFn,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockExecAsync: jest.Mock = (require('util') as any).__mockExecAsync;

describe('getLocalIpAddress', () => {
  const mockedNetworkInterfaces = networkInterfaces as jest.MockedFunction<typeof networkInterfaces>;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return valid IPv4 address', () => {
    mockedNetworkInterfaces.mockReturnValue({
      eth0: [
        {
          address: '192.168.1.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.1.100/24',
        },
      ],
    });

    const result = getLocalIpAddress();
    expect(result).toBe('192.168.1.100');
  });

  it('should skip internal (loopback) addresses', () => {
    mockedNetworkInterfaces.mockReturnValue({
      lo: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      eth0: [
        {
          address: '10.0.0.50',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: '10.0.0.50/24',
        },
      ],
    });

    const result = getLocalIpAddress();
    expect(result).toBe('10.0.0.50');
  });

  it('should skip IPv6 addresses', () => {
    mockedNetworkInterfaces.mockReturnValue({
      eth0: [
        {
          address: 'fe80::1',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: 'fe80::1/64',
          scopeid: 1,
        },
        {
          address: '192.168.50.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.50.100/24',
        },
      ],
    });

    const result = getLocalIpAddress();
    expect(result).toBe('192.168.50.100');
  });

  it('should return first valid address when multiple interfaces exist', () => {
    mockedNetworkInterfaces.mockReturnValue({
      eth0: [
        {
          address: '10.0.1.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: '10.0.1.100/24',
        },
      ],
      eth1: [
        {
          address: '192.168.1.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:02',
          internal: false,
          cidr: '192.168.1.100/24',
        },
      ],
    });

    const result = getLocalIpAddress();
    // Should return one of the valid addresses (order may vary)
    expect(['10.0.1.100', '192.168.1.100']).toContain(result);
  });

  it('should return 127.0.0.1 when no valid addresses are found', () => {
    mockedNetworkInterfaces.mockReturnValue({
      lo: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
    });

    const result = getLocalIpAddress();
    expect(result).toBe('127.0.0.1');
  });

  it('should handle empty network interfaces', () => {
    mockedNetworkInterfaces.mockReturnValue({});

    const result = getLocalIpAddress();
    expect(result).toBe('127.0.0.1');
  });
});

describe('configureSmbAdDns', () => {
  const mockLogger = { log: jest.fn(), warn: jest.fn() };
  const originalPlatform = process.platform;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('should be a no-op on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    await configureSmbAdDns('trace-1', '10.0.0.1', mockLogger);
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it('should skip add when IP is already present anywhere in the DNS list', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // IP already present — existing DNS order must not be disturbed
    mockExecAsync.mockResolvedValueOnce({ stdout: '8.8.8.8\n10.0.0.1\n172.30.1.5\n', stderr: '' });

    await configureSmbAdDns('trace-1', '10.0.0.1', mockLogger);

    expect(mockExecAsync).toHaveBeenCalledTimes(1); // only show, no add
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('already present'));
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('skipping'));
  });

  it('should add at index=1 when IP is not in the list', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '8.8.8.8\n172.30.1.5\n', stderr: '' }) // show — IP absent
      .mockResolvedValueOnce({ stdout: '', stderr: '' });                       // add at index=1

    await configureSmbAdDns('trace-1', '10.0.0.50', mockLogger);

    expect(mockExecAsync).toHaveBeenCalledTimes(2);
    const addCall = mockExecAsync.mock.calls[1][0] as string;
    expect(addCall).toContain('add dns');
    expect(addCall).toContain('10.0.0.50');
    expect(addCall).toContain('index=1');
    expect(addCall).toContain('validate=no');
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('added at index=1'));
  });

  it('should warn and not throw when netsh show command fails (e.g. Group Policy lock)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecAsync.mockRejectedValueOnce(new Error('Access is denied'));

    await expect(configureSmbAdDns('trace-1', '10.0.0.1', mockLogger)).resolves.not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to configure AD DNS'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('10.0.0.1'));
  });

  it('should warn and not throw when netsh add command fails (e.g. Group Policy lock)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '8.8.8.8\n', stderr: '' })  // show — IP absent
      .mockRejectedValueOnce(new Error('Access is denied'));         // add blocked by policy

    await expect(configureSmbAdDns('trace-1', '10.0.0.1', mockLogger)).resolves.not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to configure AD DNS'));
  });

  it('should handle multiple file servers with different AD IPs independently', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // Both IPs absent from DNS list
    mockExecAsync.mockResolvedValue({ stdout: '8.8.8.8\n', stderr: '' });

    await configureSmbAdDns('trace-1', '10.0.0.1', mockLogger);
    await configureSmbAdDns('trace-2', '10.0.0.2', mockLogger);

    expect(mockExecAsync).toHaveBeenCalledTimes(4); // show + add for each
    const addCalls = mockExecAsync.mock.calls.filter((c: any[]) => (c[0] as string).includes('add dns'));
    expect(addCalls[0][0]).toContain('10.0.0.1');
    expect(addCalls[1][0]).toContain('10.0.0.2');
  });

  it('should not call add when second file server IP is already present', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '8.8.8.8\n', stderr: '' })       // first IP absent — show
      .mockResolvedValueOnce({ stdout: '', stderr: '' })                  // first IP add
      .mockResolvedValueOnce({ stdout: '8.8.8.8\n10.0.0.2\n', stderr: '' }); // second IP already present — show only

    await configureSmbAdDns('trace-1', '10.0.0.1', mockLogger);
    await configureSmbAdDns('trace-2', '10.0.0.2', mockLogger);

    expect(mockExecAsync).toHaveBeenCalledTimes(3); // show+add for first, show-only for second
    const addCalls = mockExecAsync.mock.calls.filter((c: any[]) => (c[0] as string).includes('add dns'));
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][0]).toContain('10.0.0.1');
  });
});
