import { JobType } from "src/constants/enums"
import { TaskEventPayload } from "./workmanager.types"

export const buildScanPayload = (path: string) => ({
    fPath: path,
    ops: {
        0 : {
            cmd : "SCAN_PATH"
        }
    }
})


export const buildRequest = (payload: TaskEventPayload) => {
    switch (payload.taskType){
        case JobType.Scan: 
            return buildScanPayload(payload.sPath)
        default: return
    }
}