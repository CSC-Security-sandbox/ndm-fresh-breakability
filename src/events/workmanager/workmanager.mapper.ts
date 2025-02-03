
export const buildScanPayload = (path: string) => ({
    fPath: path,
    ops: {
        0 : {
            cmd : "SCAN_PATH"
        }
    }
})

// TODO : Need to make changes ine the payload structure
export const buildMigrationPayload = (sourcePath: string, targetPath: string) => ({
    fPath: sourcePath,
    ops: {
        0 : {
            cmd : "MIGRATE_PATH",
            targetPath
        }
    }
})

// export const buildRequest = (payload: TaskEventPayload) => {
//     switch (payload.taskType){
//         case JobType.DISCOVER: 
//             const path =  `${payload.workingDirectory}/${payload.jobRunId}/${payload.sPathId}`
//             return buildScanPayload(payload.sPath)
//         default: return
//     }
// }