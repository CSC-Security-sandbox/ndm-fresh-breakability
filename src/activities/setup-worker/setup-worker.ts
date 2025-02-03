import { WorkersConfig } from "src/config/app.config";
import { Logger } from 'src/logger/logger.service';
import { JobContextFactory, RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from "axios";
import { Protocol } from "src/protocols/protocol/protocol";
import { ProtocolTypes, Protocols } from "src/protocols/protocols";



export async function setup(traceId: string): Promise<any> {
    const logger = new Logger();
   // const workerId = WorkersConfig.get('workerId');
   const workerId = '6cf21220-5627-4614-a947-778915dba29f';
    let redisClient = null;
  
    logger.info(`[${traceId}] - [${workerId}] Setting up worker`);
  
    try {
      redisClient = await RedisUtils.getClient();
      if (!redisClient.isOpen) {
        await redisClient.connect();
        logger.info(`[${traceId}] - Redis client connected.`);
      }
      const contextProvider = JobContextFactory.getProvider('redis', redisClient);
      const context = await contextProvider.getJobContext(traceId);
      console.log('context----->', context.jobConfig.sourceFileServer.hostname) ;  
  
      if (!context) {
        logger.error(`[${traceId}] - Context not found for traceId ${traceId}`);
        return {
          traceId,
          status: 'error',
          protocolType: null,
          hostname: null,
          workerId,
          message: `[${traceId}] - Could not find context for traceId ${traceId}`,
        };
      }
  
    
      const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
      const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      const hostname = context.jobConfig.sourceFileServer.hostname;
      const path = context.jobConfig.sourcePath;
      console.log('hostname----->', hostname);
      const payload = {
        hostname: hostname,
        username: 'root',
        password: '',
        path: context.jobConfig.sourcePath,
        jobRunId: traceId

      }
      await protocol.mountPath(traceId,payload);
  
      logger.info(`[${traceId}] - Protocol: ${protocolType}, Hostname: ${hostname}, Path: ${path}`);
      logger.info(
        `[${traceId}] - [${protocolType}] Worker ${workerId} is being set up for ${hostname}/${path}`
      );
  
      const workerConfigUrl = WorkersConfig.get('workerConfigUrl');
      const activeWorkerIds = [workerId];
      logger.info(`[${traceId}] - Worker config URL: ${workerConfigUrl}`);
      logger.info(
        `[${traceId}] - Active workers: ${JSON.stringify(activeWorkerIds)}, Control Plan URL: ${workerConfigUrl}`
      );
  
      await axios.post(`${workerConfigUrl}update/configs`, {
        jobRunId: traceId,
        workerIds: activeWorkerIds,
      });
  
      logger.info(`[${traceId}] - Control plane notified about active workers.`);
  
      return {
        traceId,
        status: 'success',
        protocolType,
        hostname,
        workerId,
        message: `[${traceId}] - Worker ${workerId} successfully set up for ${hostname}/${path}`,
      };
    } catch (error) {
      logger.error(
        `[${traceId}] - Failed to set up worker ${workerId}: ${error.message}`,
      );
      return {
        traceId,
        status: 'error',
        protocolType: null,
        hostname: null,
        workerId,
        message: `[${traceId}] - Worker setup failed: ${error.message}`,
      };
    } finally {
      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        logger.info(`[${traceId}] - Redis client connection closed.`);
      }
    }
  }

  export async function cleanup(
    traceId: string,
    protocolType: string,
    payload: any
  ): Promise<any> {
    const logger = new Logger();
    const workerId = WorkersConfig.get('workerId');
  
    logger.info(
      `[${traceId}] - [${protocolType}] Cleaning up worker ${workerId} for ${payload.hostname}/${payload.path}`
    );
  
    try {
      const protocol: Protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      await protocol.unmountPath(traceId, payload);
  
      logger.info(
        `[${traceId}] - [${protocolType}] Worker ${workerId} cleanup successfully completed for ${payload.hostname}/${payload.path}`
      );
  
      return {
        traceId,
        status: 'success',
        protocolType,
        hostname: payload.hostname,
        workerId,
        message: `[${traceId}] - Worker cleanup successfully completed for ${payload.hostname}/${payload.path}`,
      };
    } catch (error) {
      logger.error(
        `[${traceId}] - [${protocolType}] Failed to cleanup worker ${workerId}: ${error.message}`,
      );
  
      return {
        traceId,
        status: 'error',
        protocolType,
        hostname: payload.hostname,
        workerId,
        message: `[${traceId}] - Worker cleanup failed: ${error.message}`,
      };
    }
  }