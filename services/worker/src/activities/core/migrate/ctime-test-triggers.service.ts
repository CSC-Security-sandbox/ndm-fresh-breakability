import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { execSync } from "child_process";
import * as path from "path";

@Injectable()
export class CtimeTestTriggersService {
    private readonly logger: LoggerService;
    private readonly enabled: boolean;

    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        @Inject(ConfigService) configService: ConfigService,
    ) {
        this.logger = loggerFactory.create(CtimeTestTriggersService.name);
        this.enabled = configService.get<boolean>('worker.ctimeTestTriggerEnabled', true);
    }

    testExhaustAllRetries(sourcePath: string, attempt: number, cmdId: string): void {
        const testFile = 'bucket0\\sos4.oia';
        if (!this.enabled || !sourcePath.endsWith(testFile)) {
            return;
        }
        const permByAttempt: Record<number, string> = { 1: 'Read', 2: 'Write', 3: 'FullControl' };
        const adding = permByAttempt[attempt] || 'Modify';
        this.logger.warn(
            `[${cmdId}] TEST: testExhaustAllRetries | file=${testFile} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| attempt=${attempt} | ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-exhaust-all-retries.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries completed | file=${testFile} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries failed | file=${testFile}: ${err.message}`);
        }
    }

    testChangeBetweenT2EndAndT3(sourcePath: string, attempt: number, cmdId: string): void {
        const testFile = 'bucket0\\bhyryeul8';
        if (!this.enabled || !sourcePath.endsWith(testFile)) {
            return;
        }
        const adding = 'Write';
        const skipping = attempt > 1;
        this.logger.warn(
            `[${cmdId}] TEST: testChangeBetweenT2EndAndT3 | file=${testFile} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| attempt=${attempt} | skip=${skipping} | ${sourcePath}`,
        );
        if (skipping) return;
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-change-between-t2end-and-t3.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2EndAndT3 completed | file=${testFile} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2EndAndT3 failed | file=${testFile}: ${err.message}`);
        }
    }

    testChangeBetweenT3AndDirRestamp(sourcePath: string, jobRunId: string): void {
        const testDir = 'Dir0\\bucket1';
        if (!this.enabled || !sourcePath.endsWith(testDir)) {
            return;
        }
        const adding = 'Modify';
        this.logger.warn(
            `[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp | dir=${testDir} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-change-between-t3-and-dir-restamp.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}"`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp completed | dir=${testDir} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp failed | dir=${testDir}: ${err.message}`);
        }
    }
}
