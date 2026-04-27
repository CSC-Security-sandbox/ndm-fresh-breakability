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

    testChangeBetweenT1AndT2Start(sourcePath: string, attempt: number, cmdId: string): void {
        if (!this.enabled || !sourcePath.endsWith('bucket0\\bhyryeul8')) {
            return;
        }
        const adding = 'Read';
        const skipping = attempt > 1;
        this.logger.warn(
            `[${cmdId}] TEST: testChangeBetweenT1AndT2Start | permission is getting changed for kiran `
            + `| current → adding ${adding} (Allow) | attempt=${attempt} | skip=${skipping} | ${sourcePath}`,
        );
        if (skipping) return;
        try {
            const scriptPath = path.resolve(process.cwd(), 'test-change-between-t1-and-t2start.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT1AndT2Start completed | permission changed to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT1AndT2Start failed: ${err.message}`);
        }
    }

    testExhaustAllRetries(sourcePath: string, attempt: number, cmdId: string): void {
        if (!this.enabled || !sourcePath.endsWith('bucket0\\bhyryeul8')) {
            return;
        }
        const permByAttempt: Record<number, string> = { 1: 'Read', 2: 'Write', 3: 'FullControl' };
        const adding = permByAttempt[attempt] || 'Modify';
        this.logger.warn(
            `[${cmdId}] TEST: testExhaustAllRetries | permission is getting changed for kiran `
            + `| current → adding ${adding} (Allow) | attempt=${attempt} | ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test-exhaust-all-retries.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries completed | permission changed to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testExhaustAllRetries failed: ${err.message}`);
        }
    }

    testChangeBetweenT2EndAndT3(sourcePath: string, attempt: number, cmdId: string): void {
        if (!this.enabled || !sourcePath.endsWith('bucket0\\bhyryeul8')) {
            return;
        }
        const adding = 'Write';
        const skipping = attempt > 1;
        this.logger.warn(
            `[${cmdId}] TEST: testChangeBetweenT2EndAndT3 | permission is getting changed for kiran `
            + `| current → adding ${adding} (Allow) | attempt=${attempt} | skip=${skipping} | ${sourcePath}`,
        );
        if (skipping) return;
        try {
            const scriptPath = path.resolve(process.cwd(), 'test-change-between-t2end-and-t3.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}" -Attempt ${attempt}`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2EndAndT3 completed | permission changed to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${cmdId}] TEST: testChangeBetweenT2EndAndT3 failed: ${err.message}`);
        }
    }

    testChangeBetweenT3AndDirRestamp(sourcePath: string, jobRunId: string): void {
        if (!this.enabled || !sourcePath.endsWith('Dir0\\bucket0')) {
            return;
        }
        const adding = 'Modify';
        this.logger.warn(
            `[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp | permission is getting changed for kiran `
            + `| current → adding ${adding} (Allow) | ${sourcePath}`,
        );
        try {
            const scriptPath = path.resolve(process.cwd(), 'test-change-between-t3-and-dir-restamp.ps1');
            const result = execSync(
                `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -SharePath "${sourcePath}"`,
                { timeout: 15000, encoding: 'utf-8' },
            );
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp completed | permission changed to ${adding} for kiran\n${result}`);
        } catch (err) {
            this.logger.warn(`[${jobRunId}] TEST: testChangeBetweenT3AndDirRestamp failed: ${err.message}`);
        }
    }
}
