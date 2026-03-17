import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorType, JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerService, LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import * as fs from "fs";
import * as crypto from "crypto";
import { dmError } from "src/activities/utils/utils";
import { isPathExists } from "../utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { FatalError } from "src/errors/errors.types";
import { Cmd } from "@netapp-cloud-datamigrate/jobs-lib";

export interface StreamDirToRedisInput {
    dirPath: string;
    redisKey: string;
    jobContext: JobManagerContext;
    origin: Origin;
    errorType: ErrorType;
    command: Cmd;
    buildLowercaseSet?: boolean;
}

export interface StreamDirToRedisResult {
    totalCount: number;
    redisKey: string;
    lowercaseRedisKey?: string;
}

@Injectable()
export class DirStreamingService {
    private readonly batchSize: number;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.batchSize = this.configService.get<number>('worker.dirStreamBatchSize') || 5000;
        this.logger = loggerFactory.create(DirStreamingService.name);
    }

    /**
     * Generates a deterministic Redis key for a directory path.
     */
    getDirContentKey(dirPath: string): string {
        return crypto.createHash('sha256').update(dirPath).digest('hex').substring(0, 16);
    }

    /**
     * Streams directory entries into a Redis Set using opendir().
     * Memory: O(batchSize) instead of O(totalFiles).
     *
     * Each batch of entries is flushed to Redis via a single SADD call.
     * Optionally builds a parallel lowercase Redis Set for SMB case conflict detection.
     */
    async streamDirToRedisSet(input: StreamDirToRedisInput): Promise<StreamDirToRedisResult> {
        const { dirPath, redisKey, jobContext, origin, errorType, command, buildLowercaseSet } = input;
        const lowercaseRedisKey = buildLowercaseSet ? `${redisKey}:lc` : undefined;

        try {
            const pathExists = await isPathExists(dirPath);
            if (!pathExists) {
                if (origin === Origin.SOURCE) {
                    throw new FatalError(`Source directory does not exist: ${dirPath}`);
                }
                return { totalCount: 0, redisKey, lowercaseRedisKey };
            }

            const dir = await fs.promises.opendir(dirPath);
            let buffer: string[] = [];
            let lcBuffer: string[] = [];
            let totalCount = 0;

            for await (const dirent of dir) {
                buffer.push(dirent.name);
                if (buildLowercaseSet) {
                    lcBuffer.push(dirent.name.toLowerCase());
                }
                totalCount++;

                if (buffer.length >= this.batchSize) {
                    await jobContext.addToDirContentSet(redisKey, buffer);
                    if (buildLowercaseSet && lcBuffer.length > 0) {
                        await jobContext.addToDirContentSet(lowercaseRedisKey!, lcBuffer);
                    }
                    buffer = [];
                    lcBuffer = [];
                }
            }

            // Flush remaining entries
            if (buffer.length > 0) {
                await jobContext.addToDirContentSet(redisKey, buffer);
                if (buildLowercaseSet && lcBuffer.length > 0) {
                    await jobContext.addToDirContentSet(lowercaseRedisKey!, lcBuffer);
                }
            }

            return { totalCount, redisKey, lowercaseRedisKey };
        } catch (error) {
            if (error instanceof FatalError) {
                const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, ErrorType.FATAL_ERROR, command.id, error, { name: command.fPath, path: dirPath });
                await jobContext.publishToErrorStream(ndmError);
                throw error;
            }
            if (origin === Origin.DESTINATION && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                return { totalCount: 0, redisKey, lowercaseRedisKey };
            }
            const ndmError = dmError("OPERATION", origin, Operation.READ_DIR, errorType, command.id, error, { name: command.fPath, path: dirPath });
            await jobContext.publishToErrorStream(ndmError);
            throw error;
        }
    }

    /**
     * AsyncGenerator that yields batches of filenames from a directory using opendir().
     * Memory: O(batchSize) per yield.
     *
     * Used for source-side processing where entries feed into processItems().
     */
    async *streamDirEntries(dirPath: string): AsyncGenerator<string[]> {
        const dir = await fs.promises.opendir(dirPath);
        let buffer: string[] = [];

        for await (const dirent of dir) {
            buffer.push(dirent.name);

            if (buffer.length >= this.batchSize) {
                yield buffer;
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            yield buffer;
        }
    }

    /**
     * AsyncGenerator that yields batches of Dirent entries from a directory using opendir().
     * Memory: O(batchSize) per yield.
     *
     * Used for discovery-scan which needs file type information from Dirent.
     */
    async *streamDirEntriesWithFileTypes(dirPath: string): AsyncGenerator<fs.Dirent[]> {
        const dir = await fs.promises.opendir(dirPath);
        let buffer: fs.Dirent[] = [];

        for await (const dirent of dir) {
            buffer.push(dirent);

            if (buffer.length >= this.batchSize) {
                yield buffer;
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            yield buffer;
        }
    }

    /**
     * Iterates a Redis Set using SSCAN and checks each batch against another Redis Set.
     * Returns entries that are NOT members of the other set.
     *
     * Used for delete detection: iterate target entries, find those not in source.
     */
    async *scanForNonMembers(
        jobContext: JobManagerContext,
        scanKey: string,
        checkAgainstKey: string,
    ): AsyncGenerator<string[]> {
        let cursor = 0;
        do {
            const { cursor: nextCursor, members } = await jobContext.scanDirContentSet(scanKey, cursor, this.batchSize);
            cursor = nextCursor;

            if (members.length === 0) continue;

            const membershipResults = await jobContext.areDirContentMembers(checkAgainstKey, members);
            const nonMembers = members.filter((_, idx) => !membershipResults[idx]);

            if (nonMembers.length > 0) {
                yield nonMembers;
            }
        } while (cursor !== 0);
    }
}
