import { exec } from "child_process";
import { WorkersConfig } from "src/config/app.config";
import Logger from "src/logger/logging";


export abstract class Protocol {
    protected logger = Logger.getLogger();
    protected workerId = WorkersConfig.get('workerId');
    protected baseMountDir = WorkersConfig.get('baseMountDir');
    protected platform = WorkersConfig.get('platform');

    abstract listPaths(traceId: string, payload: any): Promise<any>;
    abstract getProtocolVersions(traceId: string, payload: any): Promise<any>;
    // abstract mountPath(traceId: string, payload: any): Promise<any>;
    // abstract unmountPath(traceId: string, payload: any): Promise<any>;


    protected async executeCommand(
        traceId: string,
        protocolType: string,
        payload: any,
        commandPattern: string,
        commandDescription: string,
      ): Promise<any> {
      
        const response = {
          traceId: traceId,
          status: 'success',
          protocolType: protocolType,
          hostname: payload.hostname,
          workerId: this.workerId,
          message: `[${protocolType}] [${commandDescription}] Successful. Hostname: ${payload.hostname} Worker: ${this.workerId}`,
        };
      
        const command = commandPattern
          ?.replace('${HOST}', payload?.hostname)
          ?.replace('${USERNAME}', payload?.username)
          ?.replace('${PASSWORD}', payload?.password)
          ?.replace('${PATH}', payload?.path)
          ?.replace('${JOB_RUN_ID}', payload?.jobRunId)
          ?.replace('${BASE_DIR}', this.baseMountDir);
      
        return new Promise((resolve) => {
          exec(command, (error, stdout, stderr) => {
            this.logger.info(
              `[${traceId}] command: ${command}, stdout: ${stdout}, stderr: ${stderr}, error: ${error}`,
            );
      
            if (error) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${error}`;
              response.status = 'error';
              return resolve(response);
            }
      
            if (stderr) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${stderr}`;
              response.status = 'error';
              return resolve(response);
            }
      
            response.message = `${stdout}`;
            resolve(response);
          });
        });
      }    
}
