import { networkInterfaces } from 'os';
import * as dns from 'dns';
import { getLocalIpAddress, resolveHostnameForSmb } from './network.utils';

jest.mock('os');
jest.mock('dns', () => ({
  ...jest.requireActual('dns'),
  isIP: jest.fn(),
  Resolver: jest.fn(),
  promises: { lookup: jest.fn() },
}));

// execAsync is built via promisify(exec) at module load time.
// Mock util so the factory closure captures a controllable function.
jest.mock('util', () => {
  const actualUtil = jest.requireActual('util');
  const mockFn = jest.fn();
  return { ...actualUtil, promisify: jest.fn(() => mockFn), __mockExecAsync: mockFn };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockExecAsync: jest.Mock = (require('util') as any).__mockExecAsync;

const mockedDns = dns as jest.Mocked<typeof dns>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulates real `netsh interface ip show dns` output.
 * Windows prints one IP per line with leading whitespace.
 */
const netshShowOutput = (...ips: string[]) => ({
  stdout: [
    'Configuration for interface "Ethernet"',
    '    DNS servers configured through DHCP:  None',
    '    Statically Configured DNS Servers:',
    ...ips.map(ip => `        ${ip}`),
    '    Register with which suffix:          Primary only',
  ].join('\n'),
  stderr: '',
});

/** Simulates adapter with no DNS entries */
const netshShowEmpty = () => ({ stdout: 'Configuration for interface "Ethernet"\n    Statically Configured DNS Servers: None\n', stderr: '' });

/** No-op netsh add/show result */
const netshOk = () => ({ stdout: '', stderr: '' });

// ─── getLocalIpAddress ───────────────────────────────────────────────────────

describe('getLocalIpAddress', () => {
  const mockedNetworkInterfaces = networkInterfaces as jest.MockedFunction<typeof networkInterfaces>;

  afterEach(() => jest.clearAllMocks());

  it('should return valid IPv4 address', () => {
    mockedNetworkInterfaces.mockReturnValue({
      eth0: [{ address: '192.168.1.100', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.1.100/24' }],
    });
    expect(getLocalIpAddress()).toBe('192.168.1.100');
  });

  it('should skip internal (loopback) addresses', () => {
    mockedNetworkInterfaces.mockReturnValue({
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      eth0: [{ address: '10.0.0.50', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '10.0.0.50/24' }],
    });
    expect(getLocalIpAddress()).toBe('10.0.0.50');
  });

  it('should skip IPv6 addresses', () => {
    mockedNetworkInterfaces.mockReturnValue({
      eth0: [
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: 'fe80::1/64', scopeid: 1 },
        { address: '192.168.50.100', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.50.100/24' },
      ],
    });
    expect(getLocalIpAddress()).toBe('192.168.50.100');
  });

  it('should return 127.0.0.1 when no valid addresses are found', () => {
    mockedNetworkInterfaces.mockReturnValue({
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
    });
    expect(getLocalIpAddress()).toBe('127.0.0.1');
  });

  it('should handle empty network interfaces', () => {
    mockedNetworkInterfaces.mockReturnValue({});
    expect(getLocalIpAddress()).toBe('127.0.0.1');
  });
});

// ─── resolveHostnameForSmb ───────────────────────────────────────────────────

describe('resolveHostnameForSmb', () => {
  const mockLogger = { log: jest.fn(), warn: jest.fn() };
  const originalPlatform = process.platform;

  let mockResolve4: jest.Mock;
  let mockResolverInstance: { setServers: jest.Mock; resolve4: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve4 = jest.fn();
    mockResolverInstance = { setServers: jest.fn(), resolve4: mockResolve4 };
    (mockedDns.Resolver as jest.Mock).mockImplementation(() => mockResolverInstance);
    // Default: hostname is not an IP
    (mockedDns.isIP as jest.Mock).mockReturnValue(0);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  const winPlatform = () =>
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  // ── Basic behaviour ─────────────────────────────────────────────────────────

  describe('basic behaviour', () => {
    it('should return hostname unchanged on non-Windows platforms (linux)', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const result = await resolveHostnameForSmb('t1', 'fileserver.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('fileserver.corp.local');
      expect(mockExecAsync).not.toHaveBeenCalled();
      expect(mockedDns.Resolver).not.toHaveBeenCalled();
    });

    it('should return hostname unchanged on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      const result = await resolveHostnameForSmb('t1', 'fileserver.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('fileserver.corp.local');
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('should return hostname as-is when it is already an IPv4 address', async () => {
      winPlatform();
      (mockedDns.isIP as jest.Mock).mockReturnValue(4);
      const result = await resolveHostnameForSmb('t1', '192.168.1.50', '10.0.0.1', mockLogger);
      expect(result).toBe('192.168.1.50');
      expect(mockExecAsync).not.toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('already an IP'));
    });

    it('should return hostname as-is when it is already an IPv6 address', async () => {
      winPlatform();
      (mockedDns.isIP as jest.Mock).mockReturnValue(6);
      const result = await resolveHostnameForSmb('t1', '::1', '10.0.0.1', mockLogger);
      expect(result).toBe('::1');
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('should trim leading/trailing whitespace from hostname before resolution', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())       // show — absent
        .mockResolvedValueOnce(netshOk())              // add
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      const result = await resolveHostnameForSmb('t1', '  fs.corp.local  ', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
      // Resolver should have been called with the trimmed hostname
      expect(mockResolve4).toHaveBeenCalledWith('fs.corp.local', expect.any(Function));
    });
  });

  // ── Edge case 1: Customer's Windows VM has pre-configured DNS ──────────────
  //
  // Policy: We NEVER delete or overwrite existing DNS entries.
  // We only ADD the adServerIp if it is not already present.
  // The customer's pre-existing corporate DNS entries are preserved and iterated.

  describe('Edge case 1 — pre-existing DNS on Windows VM (do not overwrite)', () => {
    it('should not delete or overwrite pre-existing DNS entries when adding new adServerIp', async () => {
      winPlatform();
      // Adapter already has corporate DNS: 172.16.0.1, 172.16.0.2
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('172.16.0.1', '172.16.0.2'))  // show — adServerIp absent
        .mockResolvedValueOnce(netshOk())                                     // add adServerIp
        .mockResolvedValueOnce(netshShowOutput('172.16.0.1', '172.16.0.2', '10.0.0.1')); // read full list
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.5.5.5']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      // Only 'add dns' should be called — no 'delete dns' or 'set dns'
      const calls = mockExecAsync.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('delete dns'))).toBe(false);
      expect(calls.some(c => c.includes('set dns'))).toBe(false);
      expect(calls.some(c => c.includes('add dns'))).toBe(true);
    });

    it('should preserve pre-existing DHCP-assigned DNS entries and resolve via them', async () => {
      winPlatform();
      // Customer has DHCP-assigned DNS 192.168.1.1 — our adServerIp is new
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('192.168.1.1'))                 // show — adServerIp absent
        .mockResolvedValueOnce(netshOk())                                      // add
        .mockResolvedValueOnce(netshShowOutput('192.168.1.1', '10.0.0.1'));    // read — both present
      // Our AD DNS fails but the pre-existing DHCP DNS resolves it
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))  // 192.168.1.1 fails
        .mockImplementationOnce((_h, cb) => cb(null, ['10.8.8.8']));          // 10.0.0.1 succeeds
      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.8.8.8');
    });

    it('should still resolve correctly when adapter has many pre-existing entries', async () => {
      winPlatform();
      // Customer has 5 DNS entries already — we append ours
      const existing = ['10.10.0.1', '10.10.0.2', '10.10.0.3', '10.10.0.4', '10.10.0.5'];
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput(...existing))                  // show — adServerIp absent
        .mockResolvedValueOnce(netshOk())                                     // add
        .mockResolvedValueOnce(netshShowOutput(...existing, '10.0.0.1'));     // read — 6 entries
      // First 5 fail, 6th (our AD) resolves
      existing.forEach(() =>
        mockResolve4.mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))
      );
      mockResolve4.mockImplementationOnce((_h, cb) => cb(null, ['10.99.99.99']));

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.99.99.99');
      expect(mockResolverInstance.setServers).toHaveBeenCalledTimes(6);
    });

    it('should not call add dns when adServerIp is already in adapter (idempotent)', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '8.8.8.8'))  // show — already present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '8.8.8.8')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      expect(mockExecAsync).toHaveBeenCalledTimes(2); // show + read only
      expect(mockLogger.log).not.toHaveBeenCalledWith(expect.stringContaining('Added AD DNS'));
    });

    it('should add only once even if called multiple times (idempotent across calls)', async () => {
      winPlatform();
      // First call: IP absent → add
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())              // show #1 — absent
        .mockResolvedValueOnce(netshOk())                     // add #1
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // read #1
        // Second call: IP now present → skip add
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show #2 — present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read #2
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      await resolveHostnameForSmb('t2', 'fs.corp.local', '10.0.0.1', mockLogger);

      const addCalls = mockExecAsync.mock.calls.filter(c => (c[0] as string).includes('add dns'));
      expect(addCalls).toHaveLength(1); // added only once
    });
  });

  // ── Edge case 2: Cross-domain / multiple AD environments ───────────────────
  //
  // Scenario: customer has 2 file servers in different AD domains.
  // Each call passes its own adServerIp. The adapter accumulates both.
  // Whichever DNS server knows about a given domain will answer — we iterate all.

  describe('Edge case 2 — cross-domain / multiple AD environments', () => {
    it('should resolve source file server hostname via its own AD DNS', async () => {
      winPlatform();
      // Source file server is in corp-us.local, AD at 10.0.0.1
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())                     // show — absent
        .mockResolvedValueOnce(netshOk())                            // add 10.0.0.1
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'));         // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.0.10']));

      const ip = await resolveHostnameForSmb('t1', 'fs-us.corp-us.local', '10.0.0.1', mockLogger);
      expect(ip).toBe('10.1.0.10');
      expect(mockResolverInstance.setServers).toHaveBeenCalledWith(['10.0.0.1']);
    });

    it('should resolve destination file server hostname via its own AD DNS', async () => {
      winPlatform();
      // Destination file server is in corp-eu.local, AD at 10.0.0.2
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())                     // show — absent
        .mockResolvedValueOnce(netshOk())                            // add 10.0.0.2
        .mockResolvedValueOnce(netshShowOutput('10.0.0.2'));         // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.2.0.20']));

      const ip = await resolveHostnameForSmb('t2', 'fs-eu.corp-eu.local', '10.0.0.2', mockLogger);
      expect(ip).toBe('10.2.0.20');
      expect(mockResolverInstance.setServers).toHaveBeenCalledWith(['10.0.0.2']);
    });

    it('should skip AD DNS that returns NXDOMAIN for wrong domain and succeed on the correct one', async () => {
      winPlatform();
      // Adapter has both AD IPs after two file servers were set up earlier.
      // We are now resolving corp-eu host. corp-us AD returns NXDOMAIN; corp-eu AD succeeds.
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2'))  // show — 10.0.0.2 already present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2')); // read
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))  // 10.0.0.1 (corp-us) fails
        .mockImplementationOnce((_h, cb) => cb(null, ['10.2.0.99']));          // 10.0.0.2 (corp-eu) succeeds

      const ip = await resolveHostnameForSmb('t3', 'fs-eu.corp-eu.local', '10.0.0.2', mockLogger);

      expect(ip).toBe('10.2.0.99');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('10.0.0.1'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('trying next'));
    });

    it('should handle 3-domain scenario — each AD only knows its own domain', async () => {
      winPlatform();
      // Three AD domains, all three IPs on adapter; resolving third domain's host
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2', '10.0.0.3')) // show — present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2', '10.0.0.3')); // read
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))  // AD1 fails
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))  // AD2 fails
        .mockImplementationOnce((_h, cb) => cb(null, ['10.3.0.50']));          // AD3 succeeds

      const ip = await resolveHostnameForSmb('t4', 'fs-apac.corp-apac.local', '10.0.0.3', mockLogger);
      expect(ip).toBe('10.3.0.50');
      expect(mockResolverInstance.setServers).toHaveBeenCalledTimes(3);
    });

    it('should fall back to system DNS when no AD server knows the domain', async () => {
      winPlatform();
      // Both AD servers return NXDOMAIN — fall back to corporate system DNS
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2'))  // show — present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(new Error('NXDOMAIN'), null));
      (mockedDns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.50.50.50', family: 4 });

      const ip = await resolveHostnameForSmb('t5', 'fs.corp.local', '10.0.0.2', mockLogger);
      expect(ip).toBe('10.50.50.50');
    });
  });

  // ── Edge case 3: DNS added at multiple lifecycle points ────────────────────
  //
  // The adServerIp is added:
  //   (a) File server creation / validate-connection
  //   (b) List-path refresh (DNS may have changed on the VM since creation)
  //   (c) Each job setup mount (in case customer forgot to update file server or IP changed)
  //
  // Expectation: each call is idempotent and non-destructive regardless of when it runs.

  describe('Edge case 3 — DNS configured at multiple lifecycle points', () => {
    it('(a) file server creation: adds IP fresh, resolves correctly', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())              // show — no entries
        .mockResolvedValueOnce(netshOk())                     // add
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      const result = await resolveHostnameForSmb('validate', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Added AD DNS 10.0.0.1'));
    });

    it('(b) list-path refresh: IP already present from creation — no duplicate add', async () => {
      winPlatform();
      // Simulates the adapter already having the IP from the creation call
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show — present from earlier
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      const result = await resolveHostnameForSmb('list-path', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
      expect(mockExecAsync).toHaveBeenCalledTimes(2); // show + read, no add
    });

    it('(b) list-path refresh: Windows DNS changed since creation — new IP added without removing old', async () => {
      winPlatform();
      // Adapter DNS changed on the VM (DHCP renewal rotated IPs)
      // Old adServerIp is gone from adapter; needs to be re-added
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('192.168.10.1'))              // show — IP gone
        .mockResolvedValueOnce(netshOk())                                    // re-add
        .mockResolvedValueOnce(netshShowOutput('192.168.10.1', '10.0.0.1')); // read — both present
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null)) // 192.168.10.1 fails
        .mockImplementationOnce((_h, cb) => cb(null, ['10.1.1.1']));         // 10.0.0.1 succeeds

      const result = await resolveHostnameForSmb('list-path-refresh', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Added AD DNS 10.0.0.1'));
    });

    it('(c) job setup mount: adServerIp unchanged — idempotent, no duplicate entry', async () => {
      winPlatform();
      // Job starts; IP is already in adapter from list-path or creation
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show — still present
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      const result = await resolveHostnameForSmb('job-setup', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
      expect(mockExecAsync).toHaveBeenCalledTimes(2); // no add
    });

    it('(c) job setup mount: customer forgot to update file server, old IP on adapter, new IP provided — both tried', async () => {
      winPlatform();
      // Customer's file server still has old adServerIp=10.0.0.1 in NDM DB,
      // but actual AD moved to 10.0.0.5. Old IP is on adapter but fails; new one is added.
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))               // show — new IP absent
        .mockResolvedValueOnce(netshOk())                                  // add new IP
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.5')); // read — both present
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('ETIMEDOUT'), null))  // old IP timed out
        .mockImplementationOnce((_h, cb) => cb(null, ['10.8.8.8']));            // new IP resolves
      const result = await resolveHostnameForSmb('job-setup-stale', 'fs.corp.local', '10.0.0.5', mockLogger);
      expect(result).toBe('10.8.8.8');
    });

    it('(c) job setup mount: no adServerIp — still resolves via whatever DNS is on the adapter', async () => {
      winPlatform();
      // Customer never set adServerIp — adapter has only their existing corporate DNS
      mockExecAsync.mockResolvedValueOnce(netshShowOutput('172.20.0.1', '172.20.0.2'));
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.4.4.4']));

      const result = await resolveHostnameForSmb('job-no-ad', 'fs.corp.local', undefined, mockLogger);
      expect(result).toBe('10.4.4.4');
      expect(mockExecAsync).toHaveBeenCalledTimes(1); // read only
    });
  });

  // ── Group Policy / netsh failures ──────────────────────────────────────────

  describe('Group Policy and netsh failure handling', () => {
    it('should warn and continue when netsh show fails — resolves via system DNS', async () => {
      winPlatform();
      mockExecAsync
        .mockRejectedValueOnce(new Error('Access is denied')) // show + add block together
        .mockResolvedValueOnce(netshShowOutput('8.8.8.8'));   // read still works
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.2.2.2']));

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Group Policy'));
      expect(result).toBe('10.2.2.2');
    });

    it('should warn and continue when netsh add is blocked — falls through to existing adapter DNS', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('8.8.8.8'))    // show — IP absent
        .mockRejectedValueOnce(new Error('Access is denied')) // add blocked by GP
        .mockResolvedValueOnce(netshShowOutput('8.8.8.8'));   // read — only pre-existing entry
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.2.2.2']));

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Group Policy'));
      expect(result).toBe('10.2.2.2'); // resolved via existing adapter DNS
    });

    it('should fall back to system DNS when GP blocks both netsh and adapter is empty', async () => {
      winPlatform();
      mockExecAsync
        .mockRejectedValueOnce(new Error('Access is denied')) // show+add blocked
        .mockRejectedValueOnce(new Error('Access is denied')); // read also blocked
      (mockedDns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.9.9.9', family: 4 });

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.9.9.9');
    });

    it('should return original hostname as last resort when everything fails', async () => {
      winPlatform();
      mockExecAsync
        .mockRejectedValueOnce(new Error('Access is denied')) // show+add blocked
        .mockRejectedValueOnce(new Error('Access is denied')); // read also blocked
      (mockedDns.promises.lookup as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('fs.corp.local');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('using original hostname'));
    });
  });

  // ── netsh output parsing ───────────────────────────────────────────────────

  describe('netsh output parsing edge cases', () => {
    it('should parse IPs from real-world netsh output with varying whitespace', async () => {
      winPlatform();
      const realNetshOutput = {
        stdout: [
          'Configuration for interface "Ethernet"',
          '    DNS servers configured through DHCP:  None',
          '    Statically Configured DNS Servers:',
          '        10.0.0.1',
          '         8.8.8.8',  // extra space
          '    10.10.10.10',   // different indent
          '    Register with which suffix:          Primary only',
        ].join('\n'),
        stderr: '',
      };
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())     // show — absent
        .mockResolvedValueOnce(netshOk())            // add
        .mockResolvedValueOnce(realNetshOutput);     // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      // All 3 IPs should have been tried
      expect(mockResolverInstance.setServers).toHaveBeenCalledTimes(1); // first one succeeds
      expect(mockResolverInstance.setServers).toHaveBeenCalledWith(['10.0.0.1']);
    });

    it('should handle adapter with no DNS entries gracefully — goes straight to system DNS', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())  // show — absent
        .mockResolvedValueOnce(netshOk())         // add
        .mockResolvedValueOnce(netshShowEmpty()); // read — still empty (GP may have blocked add)
      (mockedDns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.7.7.7', family: 4 });

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(mockedDns.Resolver).not.toHaveBeenCalled();
      expect(result).toBe('10.7.7.7');
    });

    it('should not be confused by IP-like text in non-IP lines of netsh output', async () => {
      winPlatform();
      const outputWithNoise = {
        stdout: [
          'Configuration for interface "Ethernet 2"', // "2" is not an IP
          '    Register with suffix: 192.168.x.x',    // not a real IP
          '        10.0.0.1',                          // real IP
        ].join('\n'),
        stderr: '',
      };
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show
        .mockResolvedValueOnce(outputWithNoise);              // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      const result = await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);
      expect(result).toBe('10.1.1.1');
    });
  });

  // ── DNS Resolver iteration ─────────────────────────────────────────────────

  describe('DNS resolver iteration', () => {
    it('should stop iterating as soon as first successful resolution is found', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '8.8.8.8', '1.1.1.1')); // read — 3 entries
      // First one succeeds — should not call 8.8.8.8 or 1.1.1.1
      mockResolve4.mockImplementationOnce((_h, cb) => cb(null, ['10.5.5.5']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      expect(mockResolverInstance.setServers).toHaveBeenCalledTimes(1);
      expect(mockResolverInstance.setServers).toHaveBeenCalledWith(['10.0.0.1']);
    });

    it('should create a fresh dns.Resolver for each DNS server entry', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())
        .mockResolvedValueOnce(netshOk())
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2'));
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))
        .mockImplementationOnce((_h, cb) => cb(null, ['10.2.2.2']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      // Two fresh Resolver instances — one per DNS server
      expect(mockedDns.Resolver).toHaveBeenCalledTimes(2);
    });

    it('should log which DNS server resolved the hostname', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1'))  // show
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.5.5.5']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('10.5.5.5'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('10.0.0.1'),
      );
    });

    it('should log a warning for each DNS server that fails and move on', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())
        .mockResolvedValueOnce(netshOk())
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1', '10.0.0.2'));
      mockResolve4
        .mockImplementationOnce((_h, cb) => cb(new Error('NXDOMAIN'), null))
        .mockImplementationOnce((_h, cb) => cb(null, ['10.2.2.2']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('10.0.0.1'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('trying next'),
      );
    });

    it('should never use index=1 when adding DNS entry (no forced ordering)', async () => {
      winPlatform();
      mockExecAsync
        .mockResolvedValueOnce(netshShowEmpty())              // show — absent
        .mockResolvedValueOnce(netshOk())                     // add
        .mockResolvedValueOnce(netshShowOutput('10.0.0.1')); // read
      mockResolve4.mockImplementation((_h, cb) => cb(null, ['10.1.1.1']));

      await resolveHostnameForSmb('t1', 'fs.corp.local', '10.0.0.1', mockLogger);

      const addCall = mockExecAsync.mock.calls.find(c => (c[0] as string).includes('add dns'));
      expect(addCall).toBeDefined();
      expect(addCall[0]).not.toContain('index=');
    });
  });
});
