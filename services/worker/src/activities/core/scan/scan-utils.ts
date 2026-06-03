import * as fs from 'fs';
import { Cmd, ErrorType, JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { dmError } from 'src/activities/utils/utils';
import { Operation, Origin } from 'src/activities/utils/utils.types';
import { FatalError } from 'src/errors/errors.types';

/**
 * Captures the source directory stat before opendir so the atime can be
 * restored afterwards. If lstat fails, an error is logged and the error is
 * re-thrown. The caller is responsible for publishing to the UI error stream
 * and must not proceed to read the directory's children, because the atime
 * bump from readdir cannot be undone.
 *
 * Errors with code ENOENT (source directory does not exist) throw a FatalError
 * so callers that gate on instanceof FatalError surface them as FATAL immediately.
 * All other errors throw with the original code preserved so the
 * retry-count-based errorType classification governs severity.
 */
export async function captureSourceDirAtimeStat(
    sourcePath: string,
    logger: LoggerService,
): Promise<fs.Stats> {
    try {
        return await fs.promises.lstat(sourcePath);
    } catch (err) {
        const msg = `Failed to stat source dir '${sourcePath}' for atime capture — skipping all children of this directory: ${err.message}`;
        logger.error(msg);
        if (err.code === 'ENOENT') {
            throw new FatalError(msg);
        }
        throw Object.assign(new Error(msg), { code: err.code });
    }
}

/**
 * Restores the source directory's atime to the value captured before opendir.
 * Errors are logged and published to the UI error stream but do not throw,
 * so the calling scan can complete normally.
 */
export async function preserveSourceDirAtime(
    sourcePath: string,
    sourceDirStat: fs.Stats,
    jobContext: JobManagerContext,
    command: Cmd,
    logger: LoggerService,
    errorType: ErrorType,
): Promise<void> {
    try {
        await fs.promises.utimes(sourcePath, sourceDirStat.atime, sourceDirStat.mtime);
    } catch (err) {
        const msg = `Failed to restore atime for source dir '${sourcePath}' after opendir — atime may have been bumped: ${err.message}`;
        logger.error(msg);
        const dmErr = dmError('OPERATION', Origin.SOURCE, Operation.READ_DIR, errorType, command.id, Object.assign(new Error(msg), { code: err.code }), { name: command.fPath, path: sourcePath });
        await jobContext.publishToErrorStream(dmErr);
    }
}
