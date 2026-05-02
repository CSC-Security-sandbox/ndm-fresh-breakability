import { Inject, Injectable } from "@nestjs/common";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { execSync } from "child_process";
import * as path from "path";

@Injectable()
export class CtimeTestTriggersService {
    private readonly logger: LoggerService;
    private readonly enabled: boolean;
    private readonly exhaustAllRetriesFiles: string[];
    private readonly changeBetweenT2AndT3File: string;
    private readonly changeBetweenT3AndDirRestampDir: string;

    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(CtimeTestTriggersService.name);
        this.enabled = process.env.CTIME_TEST_TRIGGER_ENABLED === 'true';
        this.exhaustAllRetriesFiles = (process.env.CTIME_TEST_EXHAUST_RETRIES_FILE || '')
            .split(',').map(f => f.trim()).filter(Boolean);
        this.changeBetweenT2AndT3File = process.env.CTIME_TEST_T2_T3_FILE || '';
        this.changeBetweenT3AndDirRestampDir = process.env.CTIME_TEST_T3_DIR_RESTAMP_DIR || '';
    }

    testExhaustAllRetries(sourcePath: string, attempt: number, cmdId: string): void {
        const matchedFile = this.exhaustAllRetriesFiles.find(f => sourcePath.endsWith(f));
        if (!this.enabled || !matchedFile) {
            return;
        }
        const permByAttempt: Record<number, string> = { 1: 'Read', 2: 'Write', 3: 'FullControl' };
        const adding = permByAttempt[attempt] || 'Modify';
        this.logger.warn(
            `[${cmdId}] TEST: testExhaustAllRetries | file=${matchedFile} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| attempt=${attempt} | ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-exhaust-all-retries.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries completed | file=${matchedFile} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries failed | file=${matchedFile}: ${err.message}`);
        }
    }

    testChangeBetweenT2AndT3(sourcePath: string, attempt: number, cmdId: string): void {
        if (!this.enabled || !this.changeBetweenT2AndT3File || !sourcePath.endsWith(this.changeBetweenT2AndT3File)) {
            return;
        }
        const adding = 'Write';
        const skipping = attempt > 1;
        this.logger.warn(
            `[${cmdId}] TEST: testChangeBetweenT2AndT3 | file=${this.changeBetweenT2AndT3File} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| attempt=${attempt} | skip=${skipping} | ${sourcePath}`,
        );
        if (skipping) return;
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-change-between-t2-and-t3.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2AndT3 completed | file=${this.changeBetweenT2AndT3File} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2AndT3 failed | file=${this.changeBetweenT2AndT3File}: ${err.message}`);
        }
    }

    testChangeBetweenT3AndDirRestamp(sourcePath: string, jobRunId: string): void {
        if (!this.enabled || !this.changeBetweenT3AndDirRestampDir || !sourcePath.endsWith(this.changeBetweenT3AndDirRestampDir)) {
            return;
        }
        const adding = 'Modify';
        this.logger.warn(
            `[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp | dir=${this.changeBetweenT3AndDirRestampDir} `
            + `| permission is getting changed for kiran | current → setting ONLY ${adding} (Allow) `
            + `| ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test', 'test-change-between-t3-and-dir-restamp.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}"`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp completed | dir=${this.changeBetweenT3AndDirRestampDir} | permission set to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp failed | dir=${this.changeBetweenT3AndDirRestampDir}: ${err.message}`);
        }
    }
}
