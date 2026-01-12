import { networkInterfaces } from 'os';
import { getLocalIpAddress } from './network.utils';

jest.mock('os');

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
