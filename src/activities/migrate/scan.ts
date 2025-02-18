
import * as fs from "fs";
import { getChecksum, getFileInfo, removePrefix, shouldExclude } from "../utils/utils";
import * as path from "path";
import { ScanContentInput, ScanContentOutput, ScanPathInput, ScanPathOutput } from "./migrate.type";
import { DMError, FileInfo, JobContextFactory, RedisUtils, TaskStats } from '@netapp-cloud-datamigrate/jobs-lib'

function* getDirectoryContents(path: string): Generator<string> {
    if(!fs.existsSync(path)) return
    try {
        const items = fs.readdirSync(path, { withFileTypes: true });
        for (const item of items) {
            yield item.name;
        }
    } catch (error) {
        console.error("Error reading directory:", error);
    }
}


const scanContent = async (scanInput: ScanContentInput) => {
    const syncContentOutput: ScanContentOutput = {files: [], directory: [], isGeneratedTask: false}
    try{
        const sourceContent = new Set<string>(await getDirectoryContents(scanInput.sourcePath))
        const targeContent = new Set<string>(await getDirectoryContents(scanInput.targetPath))

        for(const item of sourceContent) {
            const sourceContentPath = path.join(scanInput.sourcePath, item);
            if(!fs.existsSync(sourceContentPath)) continue;
            const sourceContent = fs.statSync(sourceContentPath)
            const relativeSourcePath = removePrefix(sourceContentPath, scanInput.sourcePrefix)

            if(sourceContent.isSymbolicLink() || shouldExclude(sourceContentPath, scanInput.excludePatterns)) 
                continue;


            const fileInfo: FileInfo = await getFileInfo(item, sourceContentPath, relativeSourcePath)

            if(sourceContent.isDirectory()) {
                syncContentOutput.directory.push(relativeSourcePath)
                if( scanInput.jobContext.dirsInfo)
                    scanInput.jobContext.dirsInfo.init();
                scanInput.jobContext.appendToDirList(fileInfo)
            }

            else if(!targeContent.has(item)) {
                syncContentOutput.files.push(relativeSourcePath)
                if( scanInput.jobContext.filesInfo)
                    scanInput.jobContext.filesInfo.init();
                scanInput.jobContext.appendToFileList(fileInfo)
            }

            else {
                const targetFilePath = path.join(scanInput.targetPath, item);
                if(fs.existsSync(targetFilePath)) {
                    const targetFile = fs.statSync(targetFilePath)
                    if(targetFile.isFile()) 
                        try {
                            const [checksum1, checksum2] = await Promise.all([
                                getChecksum(sourceContentPath),
                                getChecksum(targetFilePath)
                            ]);
                            if (checksum1 !== checksum2) {
                                syncContentOutput.files.push(relativeSourcePath);
                                if(scanInput.jobContext.filesInfo)
                                    scanInput.jobContext.filesInfo.init();
                                scanInput.jobContext.appendToFileList(fileInfo);
                            }
                        } catch (error) {
                            console.error("Error computing checksum:", error);
                        }
                }
            }
        }
    }catch(error) {
        if (!scanInput.jobContext.errorsInfo) 
            scanInput.jobContext.errorsInfo.init();
        const dmError = new DMError(scanInput.sourcePath as any, error);
        await scanInput.jobContext.appendToErrorList(dmError);
    }finally{
        scanInput.clientConnection?.set(scanInput.jobRunId, scanInput.jobContext)
    }
    return syncContentOutput;
}


export const scanPath = async ({task, jobContext,logger, clientConnection}: ScanPathInput):Promise<ScanPathOutput>  => {
    const scanPath:ScanPathOutput = {isTaskCreated: false};
    for(const cmd of task.commands) {
        const scanInput: ScanContentInput = {
            excludePatterns: task.excludeFilePatterns.split(','),
            jobContext: jobContext,
            logger: logger,
            sourcePath: `${task.sPath}/${cmd.fPath}`,
            sourcePrefix: task.sPath,
            targetPath: `${task.tPath}/${cmd.fPath}`,
            clientConnection,
            jobRunId: task.jobRunId
        }
        const result = await scanContent(scanInput);
        if(result.isGeneratedTask) scanPath.isTaskCreated =true
    }
    return scanPath
}


// const dir1 = "/Users/calfus-kunalavghade/Desktop/node-fs/test1";
// const dir2 = "/Users/calfus-kunalavghade/Desktop/node-fs/test3";

// const prefix = "/Users/calfus-kunalavghade/Desktop/node-fs";

// syncContent({sourcePath: dir1, targetPath: dir2, sourcePrefix:prefix,excludePatterns:[]})
//     .then(diff => console.log("Differences:", diff.files , diff.directory))
//     .catch(err => console.error("Error:", err));

// 1. modified or size change -> copyFile 
// 3. update meta -> if change
// 2. if t and !s -> delete 
