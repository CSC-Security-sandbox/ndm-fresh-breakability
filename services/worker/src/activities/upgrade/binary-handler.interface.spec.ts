import * as fsPromises from 'fs/promises';
import * as crypto from 'crypto';
import { BaseBinaryHandler } from './binary-handler.interface';

jest.mock('fs/promises');
const mockedFs = fsPromises as jest.Mocked<typeof fsPromises>;

/**
 * Concrete test handler extending BaseBinaryHandler for testing the base class.
 */
class TestLinuxHandler extends BaseBinaryHandler {
  protected readonly platform = 'linux' as const;
  protected readonly archiveExtension = '.tar.gz';
  protected readonly stagingBase = '/opt/datamigrator/staging';
  protected async extractArchive(): Promise<void> { /* no-op for test */ }
  protected getBinary(files: string[], version: string): string | undefined {
    return files.find((f) => f.includes(version) && !f.endsWith('.env') && !f.endsWith('.sha256') && !f.endsWith('.tar.gz'));
  }

  protected getChecksumFile(files: string[], version: string): string | undefined {
    return files.find((f) => f.endsWith('.sha256'));
  }
  protected getEnvFile(files: string[], version: string): string | undefined {
    return files.find((f) => f.endsWith('.env') && f !== '.env');
  }
  protected getUpgradeScript(files: string[]): string | undefined {
    return files.find((f) => f === 'upgrade.sh');
  }
  async executeUpgrade() { return { status: 'triggered' as const }; }
}

describe('BaseBinaryHandler', () => {
  let handler: TestLinuxHandler;

  const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn() };
  const mockHttpService = { get: jest.fn() };
  const mockAuthService = { getAccessToken: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new TestLinuxHandler(
      mockHttpService as any,
      mockAuthService as any,
      mockConfigService as any,
      mockLogger as any,
    );
  });

  // ===========================================================================
  // validateVersion
  // ===========================================================================

  describe('validateVersion', () => {
    it('should accept valid version strings', () => {
      expect(() => (handler as any).validateVersion('2026.02.10-nightly')).not.toThrow();
      expect(() => (handler as any).validateVersion('preview_1')).not.toThrow();
      expect(() => (handler as any).validateVersion('1.0.0')).not.toThrow();
    });

    it('should reject path traversal', () => {
      expect(() => (handler as any).validateVersion('../etc')).toThrow('Invalid version string');
      expect(() => (handler as any).validateVersion('foo/bar')).toThrow('Invalid version string');
      expect(() => (handler as any).validateVersion('')).toThrow('Invalid version string');
    });

    it('should reject shell metacharacters', () => {
      expect(() => (handler as any).validateVersion('ver;rm -rf /')).toThrow('Invalid version string');
      expect(() => (handler as any).validateVersion('ver$(cmd)')).toThrow('Invalid version string');
    });
  });

  // ===========================================================================
  // getCpBaseUrl
  // ===========================================================================

  describe('getCpBaseUrl', () => {
    const originalEnv = process.env;

    beforeEach(() => { process.env = { ...originalEnv }; });
    afterAll(() => { process.env = originalEnv; });

    it('should use CP_BASE_URL if set', () => {
      process.env.CP_BASE_URL = 'http://localhost:3001';
      expect((handler as any).getCpBaseUrl()).toBe('http://localhost:3001');
    });

    it('should construct from CONTROL_PLANE_IP', () => {
      delete process.env.CP_BASE_URL;
      process.env.CONTROL_PLANE_IP = '172.30.121.79';
      expect((handler as any).getCpBaseUrl()).toBe('https://172.30.121.79');
    });

    it('should throw when neither is set', () => {
      delete process.env.CP_BASE_URL;
      delete process.env.CONTROL_PLANE_IP;
      expect(() => (handler as any).getCpBaseUrl()).toThrow('CONTROL_PLANE_IP environment variable is not set');
    });
  });

  // ===========================================================================
  // getAuthHeaders
  // ===========================================================================

  describe('getAuthHeaders', () => {
    it('should return auth header with token', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('test-token');
      const headers = await (handler as any).getAuthHeaders();
      expect(headers).toEqual({ 'Authorization': 'Bearer test-token' });
    });

    it('should throw when token is null', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);
      await expect((handler as any).getAuthHeaders()).rejects.toThrow('Failed to obtain authentication token');
    });
  });

  // ===========================================================================
  // getStagingDir
  // ===========================================================================

  describe('getStagingDir', () => {
    it('should build versioned staging path', () => {
      const dir = (handler as any).getStagingDir('1.0.0');
      expect(dir).toContain('1.0.0');
      expect(dir).toContain('staging');
    });
  });

  // ===========================================================================
  // ensureStagingDir
  // ===========================================================================

  describe('ensureStagingDir', () => {
    it('should create directory', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);

      const dir = await (handler as any).ensureStagingDir('1.0.0');
      expect(mockedFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('1.0.0'), { recursive: true });
      expect(dir).toContain('1.0.0');
    });

    it('should throw when mkdir fails', async () => {
      mockedFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect((handler as any).ensureStagingDir('1.0.0')).rejects.toThrow('Permission denied');
    });
  });

  // ===========================================================================
  // isBinaryStaged
  // ===========================================================================

  describe('isBinaryStaged', () => {
    it('should return false when staging dir does not exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: false, platform: 'linux' });
    });

    it('should return false when binary not found in dir', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['.env' as any]);

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: false, platform: 'linux' });
    });

    it('should return true when binary is valid and versions.conf matches', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['datamigrator-worker-linux-1.0.0' as any]);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);
      mockedFs.readFile.mockResolvedValue('current_version=1.0.0\n' as any);

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: true, platform: 'linux' });
    });

    it('should return false when binary is too small', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['datamigrator-worker-linux-1.0.0' as any]);
      mockedFs.stat.mockResolvedValue({ size: 100 } as any);

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: false, platform: 'linux' });
    });

    it('should return false when versions.conf is missing', async () => {
      let accessCallCount = 0;
      mockedFs.access.mockImplementation(async (p: any) => {
        accessCallCount++;
        // First two calls succeed (staging dir, binary path), third fails (versions.conf)
        if (String(p).includes('versions.conf')) throw new Error('ENOENT');
        return undefined;
      });
      mockedFs.readdir.mockResolvedValue(['datamigrator-worker-linux-1.0.0' as any]);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: false, platform: 'linux' });
    });

    it('should return false when versions.conf version mismatches', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['datamigrator-worker-linux-1.0.0' as any]);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);
      mockedFs.readFile.mockResolvedValue('current_version=9.9.9\n' as any);

      const result = await handler.isBinaryStaged('1.0.0');
      expect(result).toEqual({ staged: false, platform: 'linux' });
    });

    it('should reject invalid version', async () => {
      await expect(handler.isBinaryStaged('../etc')).rejects.toThrow('Invalid version string');
    });
  });

  // ===========================================================================
  // verifyChecksums
  // ===========================================================================

  describe('verifyChecksums', () => {
    it('should verify matching checksums', async () => {
      const content = Buffer.from('hello');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes('.sha256')) return `${hash}  testfile` as any;
        return content;
      });
      mockedFs.access.mockResolvedValue(undefined);

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).resolves.not.toThrow();
    });

    it('should throw on checksum mismatch for binary files', async () => {
      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes('.sha256')) return 'deadbeef  binaryfile' as any;
        return Buffer.from('actual content');
      });
      mockedFs.access.mockResolvedValue(undefined);

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).rejects.toThrow('Checksum mismatch');
    });

    it('should throw when checksummed file is missing', async () => {
      mockedFs.readFile.mockResolvedValue('abc123  missingfile' as any);
      mockedFs.access.mockRejectedValue(new Error('ENOENT'));

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).rejects.toThrow('File listed in checksums not found');
    });

    it('should handle CRLF normalization for .env files', async () => {
      const lfContent = 'KEY=value\nOTHER=val\n';
      const crlfContent = 'KEY=value\r\nOTHER=val\r\n';
      const lfHash = crypto.createHash('sha256').update(lfContent).digest('hex');

      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes('.sha256')) return `${lfHash}  config.env` as any;
        return Buffer.from(crlfContent);
      });
      mockedFs.access.mockResolvedValue(undefined);

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).resolves.not.toThrow();
    });

    it('should NOT apply CRLF normalization for binary files', async () => {
      const content = Buffer.from('binary\r\ndata');
      const lfHash = crypto.createHash('sha256').update(Buffer.from('binary\ndata')).digest('hex');

      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes('.sha256')) return `${lfHash}  binaryfile` as any;
        return content;
      });
      mockedFs.access.mockResolvedValue(undefined);

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).rejects.toThrow('Checksum mismatch');
    });

    it('should strip leading * from binary mode sha256sum output', async () => {
      const content = Buffer.from('hello');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes('.sha256')) return `${hash} *testfile` as any;
        return content;
      });
      mockedFs.access.mockResolvedValue(undefined);

      await expect((handler as any).verifyChecksums('/dir', '/dir/checksums.sha256')).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // verifyBinary
  // ===========================================================================

  describe('verifyBinary', () => {
    it('should return false when file does not exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT'));
      expect(await (handler as any).verifyBinary('/staging/1.0.0/binary-1.0.0', '1.0.0')).toBe(false);
    });

    it('should return false when dir name does not contain version', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);
      expect(await (handler as any).verifyBinary('/staging/wrong/binary-1.0.0', '1.0.0')).toBe(false);
    });

    it('should return false when filename does not contain version', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);
      expect(await (handler as any).verifyBinary('/staging/1.0.0/binary-wrong', '1.0.0')).toBe(false);
    });

    it('should return false when file is too small', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({ size: 500 } as any);
      expect(await (handler as any).verifyBinary('/staging/1.0.0/binary-1.0.0', '1.0.0')).toBe(false);
    });

    it('should return true for valid binary', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as any);
      expect(await (handler as any).verifyBinary('/staging/1.0.0/binary-1.0.0', '1.0.0')).toBe(true);
    });
  });

  // ===========================================================================
  // finalizeEnv
  // ===========================================================================

  describe('finalizeEnv', () => {
    it('should rename env file to .env', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.rename.mockResolvedValue(undefined);

      const result = await (handler as any).finalizeEnv('/staging/1.0.0', '/staging/1.0.0/worker-1.0.0.env');

      expect(mockedFs.rename).toHaveBeenCalledWith(
        '/staging/1.0.0/worker-1.0.0.env',
        expect.stringContaining('.env'),
      );
      expect(result).toContain('.env');
    });
  });

  // ===========================================================================
  // cleanupStagingDir
  // ===========================================================================

  describe('cleanupStagingDir', () => {
    it('should remove directory recursively', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.rm.mockResolvedValue(undefined);

      await (handler as any).cleanupStagingDir('/staging/1.0.0');

      expect(mockedFs.rm).toHaveBeenCalledWith('/staging/1.0.0', { recursive: true, force: true });
    });

    it('should not throw when directory does not exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT'));

      await expect((handler as any).cleanupStagingDir('/staging/1.0.0')).resolves.not.toThrow();
      expect(mockedFs.rm).not.toHaveBeenCalled();
    });

    it('should log error when cleanup fails', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.rm.mockRejectedValue(new Error('Permission denied'));

      await (handler as any).cleanupStagingDir('/staging/1.0.0');

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
    });
  });

  // ===========================================================================
  // safeDelete
  // ===========================================================================

  describe('safeDelete', () => {
    it('should delete existing files', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.unlink.mockResolvedValue(undefined);
      await (handler as any).safeDelete('/file1', '/file2');
      expect(mockedFs.unlink).toHaveBeenCalledTimes(2);
    });

    it('should skip non-existing files', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT'));
      await (handler as any).safeDelete('/file1');
      expect(mockedFs.unlink).not.toHaveBeenCalled();
    });
  });
});
