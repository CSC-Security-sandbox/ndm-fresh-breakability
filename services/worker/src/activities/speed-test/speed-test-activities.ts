
import { Injectable, Inject } from '@nestjs/common';
import { FileServerDetails, SpeedTestReadWriteInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
// import * as net from 'net';
import * as ping from 'ping';
// import * as raw from 'raw-socket';
import axios from 'axios';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';
import { getErrorCode } from '../utils/utils';
import { SpeedTestOutput } from './speed-test.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

interface RoundTripDelay {
  min: number;
  avg: number;
  max: number;
  mdev: number;
}
export interface NetworkMetrics {
  packetLoss: number;
  roundTripDelay: RoundTripDelay;
}

@Injectable()
export class SpeedTestActivities {
  private readonly logger: LoggerService;
  private readonly projectId: string;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly redisService: RedisService,
  ) {
    this.logger = loggerFactory.create(SpeedTestActivities.name);
    this.projectId = WorkersConfig.get('projectId');
  }

  async readActivity(payload: any, traceId: string, volumeId:string, resultId:string): Promise<SpeedTestOutput> {
    const output: SpeedTestOutput = { errors: [], success: false, result: null };    
    try{
      this.logger.log(`[${traceId}] Starting SpeedTest Read Activity`);
      payload.status = TaskStatus.RUNNING
      const result = await this.readTest(payload.fsDetails, traceId, volumeId, resultId);
      output.success = true;
      output.result = result;
      this.logger.log(`[${traceId}] SpeedTest Read Activity Completed.`);      

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(`[${traceId}] Error encountered: ${errorMessage}`);
      output.errors.push(errorMessage);
      const result: any = {
        speedLogs: [],
        totalTimeTaken: -1,
        fileSize: -1,
        bytesWritten: -1,
        speed: -1,
      };
      output.result = result
    }
    return output;
  }

  async networkPerformanceActivity(payload: any, traceId: string): Promise<SpeedTestOutput> {
    const output: SpeedTestOutput = { errors: [], success: false, result: null };   
    const result: any = {roundTripDelay:{ min:-1, avg:-1, max:-1, mdev:-1 }, packetLoss:-1};
    try {
      this.logger.log(`[${traceId}] Starting SpeedTest Network Performance Activity`);
      payload.status = TaskStatus.RUNNING;

  
      // const packetLoss = await this.monitorPacketLoss(payload.fsDetails.hostname);
      const packetLoss = await this.calculatePacketLoss(payload.fsDetails.hostname, 10);
      
      result.packetLoss =  packetLoss
      const rtt = await this.calculatePingRtt(payload.fsDetails.hostname, 10);
      result.roundTripDelay = rtt

      output.success = true;
      output.result = result;
      this.logger.log(`[${traceId}] SpeedTest Network Performance Activity Completed.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(`[${traceId}] Error encountered: ${errorMessage}`);
      output.errors.push(errorMessage);
      output.result = result;
    }
  
    return output; // Return the original output object
  }

  async writeActivity(payload: any, traceId: string, volumeId:string, resultId:string): Promise<SpeedTestOutput> {
    const output: SpeedTestOutput = { errors: [], success: false, result: null };   
    try{
      this.logger.log(`[${traceId}] Starting SpeedTest Write Activity`);
      payload.status = TaskStatus.RUNNING
      const result = await this.writeTest(payload.fsDetails, traceId, volumeId, resultId);
      this.logger.log(`[${traceId}] SpeedTest Write Activity Completed.`);
      output.success = true;
      output.result = result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(`[${traceId}] Error encountered: ${errorMessage}`);
      output.errors.push(errorMessage);
      const result: any = {
        speedLogs: [],
        totalTimeTaken: -1,
        fileSize: -1,
        bytesWritten: -1,
        speed: -1,
      };
      output.result = result
    }
    return output;
  }

  async postResultsActivity(traceId: string, workerId: string, fileServerId: string,  results: any): Promise<any> {
  try {
    const workerJobServiceUrl = WorkersConfig.get('workerJobServiceUrl');
    const data: any = {
      traceId,
      workerId,
      fileServerID: fileServerId,
    };
    if (results?.writeResult) {
      data.writeResult = {
        ...results.writeResult.result,
        error: results.writeResult.errors?.[0] || '',
      };
    }
    
    if (results?.readResult) {
      data.readResult = {
        ...results.readResult.result,
        error: results.readResult.errors?.[0] || '',
      };
    }
    
    if (results?.networkPerformanceResult) {
      data.networkPerformanceResult = {
        ...results.networkPerformanceResult.result,
        error: results.networkPerformanceResult.errors?.[0] || '',
      };
    }
    const response = await axios.post(
      `${workerJobServiceUrl}/api/v1/jobs/speed-test/store-result`,
      data,
      { headers: { projectId: this.projectId } }
    );
    this.logger.debug(traceId, `Post call response: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    this.logger.error(traceId, `Failed to post results to API: ${error.message}`);
  }
}

  // async monitorPacketLoss(destinationIP: string): Promise<number> {
  //   const totalPackets = 1000;
  //   let retries = 0;
  //   const sentSequences = new Set<number>();
  //   const socket = raw.createSocket({ protocol: raw.Protocol.TCP });

  //   try {
  //     for (let i = 0; i < totalPackets; i++) {
  //       const seqNumber = Math.floor(Math.random() * 0xffffffff);
  //       const buffer = Buffer.alloc(40);
  //       buffer.fill(0);

  //       // Set SYN flag
  //       buffer[13] = 0x02;

  //       // Write sequence number to the buffer
  //       buffer.writeUInt32BE(seqNumber, 4);

  //       // Calculate checksum
  //       raw.writeChecksum(buffer, 16, raw.createChecksum(buffer));

  //       try {
  //         socket.send(buffer, 0, buffer.length, destinationIP, (error) => {
  //           if (error) {
  //             throw new Error(`Failed to send packet: ${error.message}`);
  //           }
  //         });

  //         if (sentSequences.has(seqNumber)) {
  //           retries++;
  //         } else {
  //           sentSequences.add(seqNumber);
  //         }
  //       } catch (error) {
  //         throw new Error(`Error sending packet: ${error.message}`);
  //       }
  //     }

  //     await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for responses
  //   } catch (error) {
  //     socket.close();
  //     throw error; // Propagate the error to the parent function
  //   }

  //   socket.close();

  //   const packetLoss = (retries / totalPackets) * 100;
  //   this.logger.debug(`Packet Loss to ${destinationIP}: ${packetLoss.toFixed(2)}%`);
  //   return packetLoss;
  // }

  async calculatePacketLoss(destinationIP: string, totalPackets: number): Promise<number> {
    let successfulPings = 0;
  
    try {
      for (let i = 0; i < totalPackets; i++) {
        try {
          const res = await ping.promise.probe(destinationIP, {
            timeout: 5, // Timeout in seconds
            extra: ['-c', '1'], // Send only one ping packet per iteration
          });
  
          if (res.alive) {
            successfulPings++;
            this.logger.debug(`Ping ${i + 1}: Success`);
          } else {
            this.logger.warn(`Ping ${i + 1}: Destination unreachable`);
          }
        } catch (error) {
          this.logger.error(`Error during ping ${i + 1}: ${error.message}`);
        }
      }
  
      // Calculate packet loss percentage
      const packetLoss = ((totalPackets - successfulPings) / totalPackets) * 100;
  
      this.logger.debug(`Packet Loss to ${destinationIP}: ${packetLoss.toFixed(2)}%`);
  
      return packetLoss ;
    } catch (error) {
      throw error; // Propagate the error to the parent function
    }
  }
  
  async calculatePingRtt(destinationIP: string, totalPackets: number): Promise<RoundTripDelay> {
    const rttValues: number[] = [];
  
    try {
      for (let i = 0; i < totalPackets; i++) {
        const startTime = Date.now(); // Record the start time
        try {
          const res = await ping.promise.probe(destinationIP, {
            timeout: 5, // Timeout in seconds
            extra: ['-c', '1'], // Send only one ping packet per iteration
          });
  
          if (res.alive) {
            const rtt = Date.now() - startTime; // Calculate RTT
            rttValues.push(rtt);
            this.logger.debug(`Ping ${i + 1}: RTT = ${rtt} ms`);
          } else {
            throw new Error(`Ping ${i + 1}: Destination unreachable`);
          }
        } catch (error) {
          throw new Error(`Error during ping ${i + 1}: ${error.message}`);
        }
      }
  
      // Calculate RTT statistics
      const min = rttValues.length > 0 ? Math.min(...rttValues) : 0;
      const max = rttValues.length > 0 ? Math.max(...rttValues) : 0;
      const avg = rttValues.length > 0 ? rttValues.reduce((sum, val) => sum + val, 0) / rttValues.length : 0;
      const mdev = rttValues.length > 0 ? Math.sqrt(rttValues.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / rttValues.length) : 0;
  
      this.logger.debug(`RTT Statistics to ${destinationIP}: Min=${min} ms, Avg=${avg.toFixed(2)} ms, Max=${max} ms, Mdev=${mdev.toFixed(2)} ms`);
  
      return { min, avg, max, mdev };
    } catch (error) {
      throw error; // Propagate the error to the parent function
    }
  }
  
  async readTest(fsDetails: FileServerDetails, traceId: string, volumeId:string, resultId:string): Promise<any> {
      const basePath = `${fsDetails.workingDirectory}/${traceId}/${volumeId}`;
      const fileName = WorkersConfig.get('speedTestFileName');
      return await this.readFile(basePath, fileName, traceId, resultId);
  }

  async writeTest(fsDetails: FileServerDetails, traceId: string, volumeId:string, resultId:string): Promise<any> {
      const basePath =  `${fsDetails.workingDirectory}/${traceId}/${volumeId}`;
      const fileName = WorkersConfig.get('speedTestFileName');
      return await this.createFile(basePath, fileName, traceId, resultId);
  }

  private async ensureDirectoryExists(basePath: string): Promise<void> {
    try {
      await fs.promises.lstat(basePath);
    } catch (error) {
      throw new Error(`Directory does not exist: ${basePath}`);
    }
  }
  
  private async checkDirPermissions(basePath: string, permission:number): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.access(basePath, permission, (err) => {
        if (err) {
          if  (fs.constants.W_OK === permission){
            reject(new Error(`No write permission for directory: ${basePath}`));
          }
          else{
            reject(new Error(`No Read permission for directory: ${basePath}`));
          }
        } else {
          resolve();
        }
      });
    });
  }

  async createFile(basePath: string, fileName: string, jobRunId: string, resultId:string) {
    try {
      await this.ensureDirectoryExists(basePath);
      await this.checkDirPermissions(basePath,  fs.constants.W_OK);
  
      const filePath = path.join(basePath, fileName);
      this.logger.debug(`Creating file at ${filePath}`);

      const fileGB = WorkersConfig.get('speedTestFileSize');
      const timeout = WorkersConfig.get('speedTestTimeout');
      const BYTES_IN_GB = 1024 * 1024 * 1024;
      const fileSize = BYTES_IN_GB * fileGB; // File size in bytes

      const startTime = performance.now();

      const buffer = Buffer.alloc(1024, 0); // Buffer with 1024 zero values
  
      const fileStream = fs.createWriteStream(filePath);
      let bytesWritten = 0;
        const jobContext = await this.redisService.getSpeedTestJobContext(jobRunId);

        // Log write speed every second
        const intervalId = setInterval(() => {
          (async () => {
            const currentTime = performance.now();
            const timeElapsed = (currentTime - startTime) / 1000; // Time in seconds
            const speed = (bytesWritten / timeElapsed) / (1024 * 1024); // Speed in MB/s
            const logMessage = `Write speed at ${Math.round(timeElapsed)} sec: ${speed.toFixed(2)} MB/s`;
            this.logger.debug(logMessage);
            const speedData = new SpeedTestReadWriteInfo(Math.round(timeElapsed).toString(), speed.toFixed(2), resultId, jobRunId);
            jobContext.appendToSpeedTestReadWriteInfo(speedData);
            await this.redisService.setJobContext(jobRunId, jobContext);
          })();
        }, 1000);
  
      return new Promise((resolve, reject) => {
        // Timeout to stop the write process
        const timeoutId = setTimeout(() => {
          fileStream.destroy(); // Stop writing to the file
          clearInterval(intervalId);
          const endTime = performance.now();
          const totalTimeTaken = (endTime - startTime) / 1000; // Time in seconds
          const speed = (bytesWritten / totalTimeTaken) / (1024 * 1024); // Speed in MB/s
          this.logger.debug(`Write process timed out after ${timeout / 1000} seconds. Data written: ${bytesWritten} bytes.`);
          resolve({
            totalTimeTaken,
            fileSize,
            bytesWritten,
            speed: speed.toFixed(2),
          });
        }, timeout);
  
        let writeIndex = 0;
  
        // Function to write chunks of data
        const writeChunk = () => {
          while (writeIndex < fileSize / buffer.length) {
            if (!fileStream.write(buffer)) {
              fileStream.once('drain', () => {
                bytesWritten += buffer.length;
                writeChunk();
              });
              return;
            }
            bytesWritten += buffer.length;
            writeIndex++;
          }
          fileStream.end();
        };
  
        writeChunk();
  
        // Handle successful file creation
        fileStream.on('finish', () => {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          const endTime = performance.now();
          const totalTimeTaken = (endTime - startTime) / 1000; // Time in seconds
          this.logger.debug(`${fileGB}GB file created in ${totalTimeTaken.toFixed(2)} seconds.`);
          resolve({
            totalTimeTaken,
            fileSize,
            bytesWritten,
            speed: (bytesWritten / totalTimeTaken / (1024 * 1024)).toFixed(2), // Speed in MB/s
          });
        });
  
        // Handle errors during file creation
        fileStream.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          const errorCode = getErrorCode(error, 'OPERATION');
          this.logger.error(`Error: ${errorCode}`);
          reject(error);
        });
      });
    } catch (error) {
      const errorCode = getErrorCode(error, 'OPERATION');
      this.logger.error(`Error: ${errorCode}`);
      throw error;
    }
  }

  async createFileIfNotExists(basePath: string, fileName: string, jobRunId: string, resultId:string) {
    try {
      await fs.promises.open(path.join(basePath, fileName), 'wx');
      await this.createFile(basePath, fileName, jobRunId, resultId);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error; // Rethrow if the error is not "file already exists"
      }
    }
  }

  async readFile(basePath: string, fileName: string, jobRunId: string, resultId:string): Promise<any> {
    try {
      const jobContext = await this.redisService.getSpeedTestJobContext(jobRunId);

      const filePath = path.join(basePath, fileName);
      const fileGB = WorkersConfig.get('speedTestFileSize');
      const timeout = WorkersConfig.get('speedTestTimeout');
      this.logger.debug(`Reading ${fileGB}GB file ${filePath}`);
  
      const BYTES_IN_GB = 1024 * 1024 * 1024;
      const fileSize = BYTES_IN_GB * fileGB;
  
      // Ensure file exists
      await this.createFileIfNotExists(basePath, fileName, jobRunId, resultId);
  
      await this.checkDirPermissions(basePath,  fs.constants.R_OK);
  
      // Start timer
      const startTime = performance.now();
  
      // Read the file
      const fileStream = fs.createReadStream(filePath);
      let bytesRead = 0;
  
      // Log the read speed every second
      const intervalId = setInterval(() => {
        (async () => {
          const currentTime = performance.now();
          const timeElapsed = (currentTime - startTime) / 1000; // time in seconds
          const speed = (bytesRead / timeElapsed) / (1024 * 1024); // speed in MB/s
          const logMessage = `Read speed at ${timeElapsed.toFixed(2)} sec: ${speed.toFixed(2)} MB/s`;
          this.logger.debug(logMessage);
          const speedData = new SpeedTestReadWriteInfo(timeElapsed.toFixed(2), speed.toFixed(2), resultId, jobRunId);
          jobContext.appendToSpeedTestReadWriteInfo(speedData);
          await this.redisService.setJobContext(jobRunId, jobContext);
         
        })();
      }, 1000);
  
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          fileStream.destroy(); // Stop reading the file
          clearInterval(intervalId);
          const endTime = performance.now();
          const totalTimeTaken = (endTime - startTime) / 1000; // time in seconds
          const speed = (bytesRead / totalTimeTaken) / (1024 * 1024); // speed in MB/s
          this.logger.debug(`Read process timed out after ${timeout / 1000} seconds. Data read: ${bytesRead} bytes.`);
          resolve({
            totalTimeTaken,
            fileSize,
            bytesRead,
            speed: speed.toFixed(2),
          });
        }, timeout);
  
        fileStream.on('data', (chunk) => {
          bytesRead += chunk.length;
        });
  
        fileStream.on('end', () => {
          clearTimeout(timeoutId); // Clear timeout if reading completes
          clearInterval(intervalId);
          const endTime = performance.now();
          const totalTimeTaken = (endTime - startTime) / 1000; // time in seconds
          const speed = (bytesRead / totalTimeTaken) / (1024 * 1024); // speed in MB/s
          this.logger.debug(`${fileGB}GB file read in ${totalTimeTaken.toFixed(2)} seconds.`);
          resolve({
            totalTimeTaken,
            fileSize,
            bytesRead,
            speed: speed.toFixed(2),
          });
        });
  
        fileStream.on('error', (operationError) => {
          clearTimeout(timeoutId); // Clear timeout on error
          clearInterval(intervalId);
          const errorCode = getErrorCode(operationError, 'OPERATION');
          this.logger.error(`Error reading file: ${errorCode}`);
          reject(operationError);
        });
      });
    } catch (error) {
      const errorCode = getErrorCode(error, 'OPERATION');
      this.logger.error(`Error: ${error}`);
      throw error;
    }
  }
}