import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { promisify } from 'util';
import { exec as execCb } from 'child_process';
import { ConfigService } from '@nestjs/config';

const exec = promisify(execCb);

@Injectable()
export class LogGeneratorService {
  private readonly baseLogPath: string;
  private readonly outputZipPath: string;
  constructor(private configService: ConfigService) {
    this.baseLogPath =
      this.configService.get<string>('BASE_LOG_PATH') ||
      '/Users/aniketdarekar/Desktop/poc/ndm_logs';
    this.outputZipPath =
      this.configService.get<string>('OUTPUT_ZIP_PATH') || '/Users/aniketdarekar/Desktop/poc/generated-zips';
  }

  async fetchAndZipLogsUsingFind({ traceId, payload }): Promise<string> {
    console.log('Started fetchAndZipLogsUsingFind activity');
    console.log(`traceId - ${traceId} & payload - ${JSON.stringify(payload)}`);
    console.log(`baseLogPath - ${this.baseLogPath}`);
    console.log(`outputZipPath - ${this.outputZipPath}`);

    console.log(
      `end date - ${payload.endDate} start date ${payload.startDate} project IDs - ${JSON.stringify(payload.projectIds)}`,
    );

    try {
      const zipRoot = 'ndm_logs';
      const zipFileName = `ndm_${payload.userId}.zip`;
      const zipPath = path.join(this.outputZipPath, zipFileName);

      // Delete old zip if exists
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }

      if (!fs.existsSync(this.outputZipPath)) {
        fs.mkdirSync(this.outputZipPath, { recursive: true });
      }

      const start = new Date(payload.startDate);
      const end = new Date(payload.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        throw new Error(
          `Invalid date range: ${payload.startDate} to ${payload.endDate}`,
        );
      }

      const dateFolders: string[] = [];
      const current = new Date(payload.startDate);
      const endDt = new Date(payload.endDate);

      while (current <= endDt) {
        const yyyyMmDd = current.toISOString().split('T')[0];
        dateFolders.push(yyyyMmDd);
        current.setUTCDate(current.getUTCDate() + 1);
      }

      const pathExpressions: string[] = [];

      for (const date of dateFolders) {
        const datePath = path.join(this.baseLogPath, date);

        for (const entry of payload?.projectWorkerMap) {
          if (entry.projectId) {
            const controlPlanePath = path.join(datePath, entry.projectId);
            pathExpressions.push(`-path "${controlPlanePath}"`);

            if (entry.projectId) {
              const projectPath = path.join(datePath, entry.projectId);
              pathExpressions.push(`-path "${projectPath}"`);
            }
          }

          if (entry.workerIds) {
            for (const wid of entry.workerIds) {
              const workerPath = path.join(datePath, 'worker', wid);
              pathExpressions.push(`-path "${workerPath}"`);
            }
          }
        }
      }

      if (pathExpressions.length === 0) {
        throw new Error('No paths generated from inputs');
      }

      const findCommand = `find "${this.baseLogPath}" -type d \\( ${pathExpressions.join(' -o ')} \\)`;

      const { stdout } = await exec(findCommand).catch((err) => {
        console.error('Error executing find:', err.stderr || err.message);
        throw new Error('Failed to execute find command');
      });

      const matchingDirs = stdout
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (matchingDirs.length === 0) {
        throw new Error(
          'No matching directories found in the given date range.',
        );
      }

      return await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
          console.log(`Zip created at: ${zipPath}`);
          resolve(zipPath);
        });

        archive.on('error', (err) => {
          console.error('Archiving error:', err);
          reject(err);
        });

        archive.pipe(output);

        for (const dir of matchingDirs) {
          const relative = path.relative(this.baseLogPath, dir);
          archive.directory(dir, path.join(zipRoot, relative));
        }

        archive.finalize();
      });
    } catch (err) {
      console.error('Error in fetchAndZipLogsUsingFind:', err.message);
      throw err;
    }
  }

  // working code with old logic

  // async fetchAndZipLogsUsingFind({ traceId, payload }): Promise<string> {
  //   console.log('Started fetchAndZipLogsUsingFind activity');
  //   console.log(`traceId - ${traceId} & payload - ${JSON.stringify(payload)}`);
  //   console.log(`baseLogPath - ${this.baseLogPath}`);
  //   console.log(`outputZipPath - ${this.outputZipPath}`);

  //   console.log(
  //     `end date - ${payload.endDate} start date ${payload.startDate} project IDs - ${JSON.stringify(payload.projectIds)}`,
  //   );

  //   try {
  //     if (!fs.existsSync(this.outputZipPath)) {
  //       fs.mkdirSync(this.outputZipPath, { recursive: true });
  //     }

  //     const zipPath = path.join(this.outputZipPath, `ndm_logs.zip`);
  //     const output = fs.createWriteStream(zipPath);
  //     const archive = archiver('zip', { zlib: { level: 9 } });

  //     const start = new Date(payload.startDate);
  //     const end = new Date(payload.endDate);
  //     if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
  //       throw new Error(
  //         `Invalid date range: ${payload.startDate} to ${payload.endDate}`,
  //       );
  //     }

  //     const dateFolders: string[] = [];
  //     const current = new Date(start);

  //     while (current <= end) {
  //       const yyyyMmDd = current.toISOString().split('T')[0];
  //       dateFolders.push(yyyyMmDd);
  //       current.setDate(current.getDate() + 1);
  //     }

  //     const pathExpressions = payload.projectIds.flatMap((projectId) =>
  //       dateFolders.map((dateFolder) => {
  //         const folderPath = path.join(this.baseLogPath, projectId, dateFolder);
  //         return `-path "${folderPath}"`;
  //       }),
  //     );

  //     if (pathExpressions.length === 0) {
  //       throw new Error('No paths generated from inputs');
  //     }

  //     const findCommand = `find "${this.baseLogPath}" -type d \\( ${pathExpressions.join(
  //       ' -o ',
  //     )} \\)`;

  //     const { stdout } = await exec(findCommand).catch((err) => {
  //       console.error('Error executing find:', err.stderr || err.message);
  //       throw new Error('Failed to execute find command');
  //     });

  //     const matchingDirs = stdout
  //       .trim()
  //       .split('\n')
  //       .map((s) => s.trim())
  //       .filter(Boolean);

  //     if (matchingDirs.length === 0) {
  //       throw new Error(
  //         'No matching log directories found for given criteria.',
  //       );
  //     }

  //     return await new Promise((resolve, reject) => {
  //       output.on('close', () => {
  //         console.log(`Zip created at: ${zipPath}`);
  //         resolve(zipPath);
  //       });

  //       archive.on('error', (err) => {
  //         console.error('Archiving error:', err);
  //         reject(err);
  //       });

  //       archive.pipe(output);

  //       const zipRoot = 'ndm_logs';

  //       for (const dir of matchingDirs) {
  //         const relative = path.relative(this.baseLogPath, dir);
  //         archive.directory(dir, path.join(zipRoot, relative));
  //       }

  //       archive.finalize();
  //     });
  //   } catch (err) {
  //     console.error('Error in fetchAndZipLogsUsingFind:', err.message);
  //     throw err;
  //   }
  // }
}
