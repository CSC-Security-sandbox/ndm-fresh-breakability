import {  Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrecheckConfig } from "../types/tasks";
import axios from "axios";

@Injectable()
export class PrecheckActivity{
    readonly jobServiceUrl: string; 
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
      ) {
        this.jobServiceUrl = this.configService.get('worker.workerJobServiceUrl');
      }
      

      async checkForCommonWorkersAndExportPath(precheckConfig:PrecheckConfig[], traceId: string): Promise<any>{
        this.logger.log(`[${traceId}] Starting Precheck Activity Check for Common Workers and Export Path ${this.jobServiceUrl}`);
        const response = await axios.post(`${this.jobServiceUrl}/api/v1/jobs/precheck/validate`, precheckConfig);
        this.logger.log(`[${traceId}] Precheck Activity Check for Common Workers and Export Path completed`);
        return response.data;
      }


}