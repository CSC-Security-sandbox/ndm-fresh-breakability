import axios from "axios";
import { log } from "console";
import { WorkersConfig } from "src/config/app.config";

export async function discoveryStatusUpdate(
  traceId: string,
  status: string
): Promise<any> {
  try {
    const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
 
    console.log(`[${traceId}] Updating discovery status to ${status}`);
    await axios.patch(`${workerJobServiceUrl}/${traceId}/${status}`);
    console.log(`[${traceId}] Discovery status updated to ${status}`);
    return {'message':"Discovery Job status updated as completed for job id: "+ traceId};
  } catch (error) {
    log(`[${traceId}] Failed to update discovery status: ${error}`);
    return {'message':"Error while updating the satus of the job id : "+ traceId};
   
  }
}