import * as workerpool from 'workerpool';
import * as path from 'path';
import * as fs from 'fs';
import { FileEntry, FileType, ProcessFolderReadParams } from './scan.childprocess.types';
import { DiscoveryPayload, MessageType } from 'src/activities/types/tasks';

export async function discovery(data: DiscoveryPayload, batchSize: number = 2000): Promise<any> {
    const inventoryData = [];
    if (!data) return;
    const ids = { jobRunId: data.data.jobRunId, workerId: data.data.workerId, transactionId: '', taskId: data.data.id, traceId: data.data.jobRunId };
    // const taskStats = new TaskStats('SCAN');
    const result = await Promise.all(data.data.commands.map(async cmd => {
        try {
            const { fPath } = cmd;
            const files = await fs.promises.readdir(fPath);
            const { accumulatedResult } = await processFolderRead({
                files,
                chunkPath: fPath,
                jobRunId: ids.jobRunId,
                pathId: data.data.sPath,
                batchSize,
                workerId: ids.workerId,
                commandId: cmd.commandId || 'test',
                excludePattern: [],
                taskId: ids.taskId
            });
            // taskStats.numFiles += accumulatedResult.length;
            inventoryData.push(...accumulatedResult);
            if (inventoryData.length >= batchSize) {
                const batch = inventoryData.splice(0, batchSize);
                workerpool.workerEmit({ ...ids, inventory: batch, type: MessageType.ProcessInventory });
            }
            return { ...cmd, ops: { 0: { ...cmd.ops[0], status: 'COMPLETED' } } };
        } catch (error) {
            return { ...cmd, ops: { 0: { ...cmd.ops[0], status: 'ERROR' } } };
        }
    }));
    if (inventoryData.length > 0) workerpool.workerEmit({ ...ids, inventory: inventoryData, type: MessageType.ProcessInventory });
    const scanCompleted = { data: { ...data.data, tarceId: ids.taskId, commands: result, status: 'COMPLETED' }, type: MessageType.ScanCompleted }
    workerpool.workerEmit(scanCompleted);
    return scanCompleted;
}

export async function processFolderRead({
    files,
    chunkPath,
    jobRunId,
    pathId,
    batchSize,
    workerId,
    commandId,
    excludePattern,
    taskId
}: ProcessFolderReadParams) {
    const accumulatedResult = [];
    const unScannedPaths = [];
    const ids = { jobRunId, workerId, transactionId: '' }
    for (const file of files) {
        const fullPath = path.join(chunkPath, file);
        const lStat = await fs.promises.lstat(fullPath);
        const isDirectory = lStat.isDirectory();
        const shouldExcludeFile = shouldExclude(fullPath, excludePattern);
        if (shouldExcludeFile) continue;
        const entry: FileEntry = {
            taskId,
            pathId,
            fileName: file,
            path: fullPath,
            parentPath: chunkPath,
            jobRunId,
            isDirectory,
            uid: lStat.uid.toString(),
            gid: lStat.gid.toString(),
            fileSize: lStat.size,
            blocks: lStat.blocks,
            modifiedTime: new Date(lStat.mtime).toISOString(),
            birthTime: new Date(lStat.birthtime).toISOString(),
            extension: path.extname(file),
            permission: getFilePermissions(lStat),
            accessTime: new Date(lStat.atime).toISOString(),
            fileType: getFileType(lStat),
            depth: fullPath.split('/').length - 2,
        };
        accumulatedResult.push(entry);
        if (entry.isDirectory) {
            unScannedPaths.push(entry.path);
            if (unScannedPaths.length >= batchSize) {
                const batch = unScannedPaths.splice(0, batchSize);
                workerpool.workerEmit({ type: MessageType.UnScannedData, unscanned: { ...ids, paths: batch } });
            }
        }
        if (accumulatedResult.length >= batchSize) {
            const batch = accumulatedResult.splice(0, batchSize);
            workerpool.workerEmit({ ...ids, inventory: batch, type: MessageType.ProcessInventory });
        }
    }
    if (unScannedPaths.length) {
        workerpool.workerEmit({ type: MessageType.UnScannedData, unscanned: { ...ids, paths: unScannedPaths } });
    }
    return { accumulatedResult };
}

export function shouldExclude(fullPath: string, excludePatterns: string[]): boolean {
    if (!excludePatterns.length) return false;
    const normalizedPath = fullPath.endsWith('/') ? fullPath : `${fullPath}/`;
    const regexPatterns = excludePatterns.map(pattern => {
        const escapedPattern = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
        const regexString = escapedPattern.replace(/\*/g, '.*');
        return new RegExp(`^${regexString}`, 'i');
    });
    const fullPathSplit = fullPath.split('/');
    for (let pattern of excludePatterns) {
        if (fullPathSplit.includes(pattern)) return true;
    }
    return regexPatterns.some(regex => regex.test(normalizedPath));
}

export function getFileType(stats: fs.Stats): FileType {
    switch (true) {
        case stats.isFile():
            return FileType.FILE;
        case stats.isDirectory():
            return FileType.DIRECTORY;
        case stats.isSymbolicLink():
            return FileType.SYMBOLIC_LINK;
        case stats.isSocket():
            return FileType.SOCKET;
        case stats.isFIFO():
            return FileType.FIFO;
        case stats.isCharacterDevice():
            return FileType.CHARACTER_DEVICE;
        case stats.isBlockDevice():
            return FileType.BLOCK_DEVICE;
        default:
            return FileType.UNKNOWN;
    }
}

export function getFilePermissions(stats: fs.Stats): string {
    const mode = stats.mode;
    const owner = (mode & 0o700) >> 6;
    const group = (mode & 0o070) >> 3;
    const others = mode & 0o007;
    const toRWX = (perm: number) => `${perm & 4 ? 'r' : '-'}${perm & 2 ? 'w' : '-'}${perm & 1 ? 'x' : '-'}`;
    const typePrefix = stats.isDirectory() ? 'd' : '-';
    return `${typePrefix}${toRWX(owner)}${toRWX(group)}${toRWX(others)}`;
}

workerpool.worker({ discovery: async (data: DiscoveryPayload) => await discovery(data) });