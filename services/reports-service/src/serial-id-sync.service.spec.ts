import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SerialIdSyncService } from './serial-id-sync.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { promises as fs } from 'fs';

jest.mock('typeorm', () => ({
  DataSource: class MockDataSource {},
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
}));

// A realistic 20-digit serial: 975 + 00 + YYMMDDHHMM + 0 + RRRR
const VALID_DB_SERIAL   = '97500260331143500123'; // first writer (DB winner)
const VALID_FILE_SERIAL = '97500260331143500456'; // different serial from conf file

describe('SerialIdSyncService', () => {
  let service: SerialIdSyncService;
  let dataSource: jest.Mocked<DataSource>;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  beforeEach(async () => {
    dataSource = { query: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialIdSyncService,
        { provide: DataSource, useValue: dataSource },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<SerialIdSyncService>(SerialIdSyncService);
    jest.clearAllMocks();
  });

  it('should mirror serial to conf file and skip INSERT when DB already has a valid serial', async () => {
    dataSource.query.mockResolvedValueOnce([
      { setting_value: VALID_DB_SERIAL, serial_id: VALID_DB_SERIAL },
    ]);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    // Only 1 query (SELECT) — no INSERT
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][0]).toContain('SELECT');
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${VALID_DB_SERIAL}\n`,
      'utf-8',
    );
  });

  it('should upsert serial from conf file when DB row is missing, then mirror DB value to file', async () => {
    dataSource.query
      .mockResolvedValueOnce([])             // SELECT — no row
      .mockResolvedValueOnce(undefined);     // INSERT DO NOTHING

    (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query.mock.calls[1][0]).toContain('INSERT INTO');
    expect(dataSource.query.mock.calls[1][0]).toContain('DO NOTHING');
    expect(dataSource.query.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['ndm_serial_id', VALID_FILE_SERIAL]),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${VALID_FILE_SERIAL}\n`,
      'utf-8',
    );
  });

  it('should generate a valid 20-digit serial when neither DB nor conf file has one', async () => {
    let capturedSerial = '';

    dataSource.query
      .mockResolvedValueOnce([]) // SELECT — no row
      .mockImplementationOnce((_sql: string, params: string[]) => {
        capturedSerial = params[1];
        return Promise.resolve(undefined);  // INSERT
      })
      .mockImplementationOnce(() =>
        Promise.resolve([{ setting_value: capturedSerial, serial_id: capturedSerial }]),  // read-back
      );

    (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(capturedSerial).toMatch(/^97500[0-9]{10}0[0-9]{4}$/);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${capturedSerial}\n`,
      'utf-8',
    );
  });

  it('should write the conf-file serial to conf file after successful upsert', async () => {
    dataSource.query
      .mockResolvedValueOnce([])             // SELECT — no row
      .mockResolvedValueOnce(undefined);     // INSERT DO NOTHING

    (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${VALID_FILE_SERIAL}\n`,  // candidate = VALID_FILE_SERIAL
      'utf-8',
    );
  });

  it('should retry DB upsert and write conf file on eventual success', async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: (v: unknown) => void) => { fn(undefined); return 0 as any; }) as any;

    dataSource.query
      .mockResolvedValueOnce([])                          // SELECT — no row
      .mockRejectedValueOnce(new Error('db unavailable')) // INSERT attempt 1 fails
      .mockResolvedValueOnce(undefined);                  // INSERT attempt 2 succeeds

    (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledTimes(3); // SELECT + fail + succeed
    expect(fs.writeFile).toHaveBeenCalled();

    global.setTimeout = originalSetTimeout;
  });

  it('should write conf file as fallback even when DB upsert fails after all retries', async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: (v: unknown) => void) => { fn(undefined); return 0 as any; }) as any;

    dataSource.query
      .mockResolvedValueOnce([])              // SELECT — no row
      .mockRejectedValue(new Error('db down')); // all INSERT attempts fail

    (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    // 1 SELECT + 10 INSERT attempts
    expect(dataSource.query).toHaveBeenCalledTimes(11);
    // File is the fallback — still written even though DB failed
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      expect.stringMatching(/^serial_id=975[0-9]{17}\n$/),
      'utf-8',
    );
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed after retries'));

    global.setTimeout = originalSetTimeout;
  });

  it('should write conf file as fallback after successful upsert when no read-back is performed', async () => {
    dataSource.query
      .mockResolvedValueOnce([])        // SELECT — no row
      .mockResolvedValueOnce(undefined); // INSERT succeeds

    (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledTimes(2); // SELECT + INSERT only
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      expect.stringMatching(/^serial_id=975[0-9]{17}\n$/),
      'utf-8',
    );
  });

  it('should fall through to file/generate when initial readSerialIdFromDb throws', async () => {
    dataSource.query
      .mockRejectedValueOnce(new Error('connection refused'))  // SELECT throws
      .mockResolvedValueOnce(undefined);                       // INSERT succeeds

    (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read serial ID from DB'),
    );
    expect(dataSource.query).toHaveBeenCalledTimes(2); // SELECT (throws) + INSERT
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${VALID_FILE_SERIAL}\n`,  // candidate = file serial
      'utf-8',
    );
  });

  it('should use setting_value when serial_id column is null in DB row', async () => {
    dataSource.query.mockResolvedValueOnce([
      { setting_value: VALID_DB_SERIAL, serial_id: null },
    ]);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('serial_id.conf'),
      `serial_id=${VALID_DB_SERIAL}\n`,
      'utf-8',
    );
  });

  it('should log warning and complete bootstrap when writeSerialIdToFile fails', async () => {
    dataSource.query.mockResolvedValueOnce([
      { setting_value: VALID_DB_SERIAL, serial_id: VALID_DB_SERIAL },
    ]);
    (fs.mkdir as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));

    await service.onApplicationBootstrap();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write serial ID to conf file'),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('should treat DB row with invalid serial as absent and fall through to file/generate', async () => {
    // DB row exists but serial doesn't match ^975[0-9]{17}$ — readSerialIdFromDb returns null
    dataSource.query
      .mockResolvedValueOnce([{ setting_value: 'INVALID_SERIAL', serial_id: 'INVALID_SERIAL' }])
      .mockResolvedValueOnce(undefined); // INSERT

    (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    // SELECT (invalid row → null) + INSERT with file serial
    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query.mock.calls[1][1]).toEqual(
      expect.arrayContaining([VALID_FILE_SERIAL]),
    );
  });

  it('should generate new serial when file exists but contains no valid serial pattern', async () => {
    dataSource.query
      .mockResolvedValueOnce([]) // SELECT — no row
      .mockResolvedValueOnce(undefined); // INSERT

    // File exists but content doesn't match regex → readSerialIdFromFile returns null
    (fs.readFile as jest.Mock).mockResolvedValueOnce('serial_id=BADVALUE\n');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    // A new serial should be generated and written
    const writtenContent: string = (fs.writeFile as jest.Mock).mock.calls[0][1];
    expect(writtenContent).toMatch(/^serial_id=975[0-9]{17}\n$/);
  });

  // ─── getSerialId ─────────────────────────────────────────────

  describe('getSerialId', () => {
    it('returns the DB serial when the DB row is present and valid (DB-first)', async () => {
      dataSource.query.mockResolvedValueOnce([
        { setting_value: VALID_DB_SERIAL, serial_id: VALID_DB_SERIAL },
      ]);

      const result = await service.getSerialId();

      expect(result).toBe(VALID_DB_SERIAL);
      // File should NOT be read — DB short-circuits the lookup
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('returns the DB serial from setting_value when serial_id column is null', async () => {
      dataSource.query.mockResolvedValueOnce([
        { setting_value: VALID_DB_SERIAL, serial_id: null },
      ]);

      const result = await service.getSerialId();

      expect(result).toBe(VALID_DB_SERIAL);
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('falls back to conf file when DB row is absent', async () => {
      dataSource.query.mockResolvedValueOnce([]); // SELECT — empty
      (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);

      const result = await service.getSerialId();

      expect(result).toBe(VALID_FILE_SERIAL);
    });

    it('falls back to conf file when DB row has an invalid serial (fails regex)', async () => {
      dataSource.query.mockResolvedValueOnce([
        { setting_value: 'INVALID', serial_id: 'INVALID' },
      ]);
      (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);

      const result = await service.getSerialId();

      expect(result).toBe(VALID_FILE_SERIAL);
    });

    it('falls back to conf file when DB query throws', async () => {
      dataSource.query.mockRejectedValueOnce(new Error('connection refused'));
      (fs.readFile as jest.Mock).mockResolvedValueOnce(`serial_id=${VALID_FILE_SERIAL}\n`);

      const result = await service.getSerialId();

      expect(result).toBe(VALID_FILE_SERIAL);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read serial ID from DB'),
      );
    });

    it('returns null when DB is empty and conf file is missing', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getSerialId();

      expect(result).toBeNull();
    });

    it('returns null when DB is empty and conf file has no valid serial pattern', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      (fs.readFile as jest.Mock).mockResolvedValueOnce('serial_id=BADVALUE\n');

      const result = await service.getSerialId();

      expect(result).toBeNull();
    });
  });
});
