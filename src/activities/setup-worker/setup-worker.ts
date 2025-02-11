import { WorkersConfig } from 'src/config/app.config';
import { Logger } from 'src/logger/logger.service';
import {
  JobContextFactory,
  RedisUtils,
} from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';

export async function setup(jobRunId: any): Promise<any> {
  const logger = new Logger();
  const workerId = WorkersConfig.get('workerId');
  let redisClient = null;

  logger.info(`[${jobRunId}] - [${workerId}] Setting up worker`);

  try {
    redisClient = await RedisUtils.getClient();
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info(`[${jobRunId}] - Redis client connected.`);
    }
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    const context = await contextProvider.getJobContext(jobRunId);
    logger.info('Job Context' + JSON.stringify(context.jobConfig));

    if (!context) {
      logger.error(`[${jobRunId}] - Context not found for traceId ${jobRunId}`);
      return {
        jobRunId,
        status: 'error',
        protocolType: null,
        hostname: null,
        workerId,
        message: `[${jobRunId}] - Could not find context for traceId ${jobRunId}`,
      };
    }

    const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
    const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
    const hostname = context.jobConfig.sourceFileServer.hostname;
    const { pathId, path, workingDirectory } =
      context.jobConfig.sourceFileServer;
    logger.info(`hostname , ${hostname}`);
    const payload = {
      hostname: hostname,
      username: 'root',
      password: '',
      path: path,
      workingDirectory: workingDirectory,
      pathId: pathId,
      jobRunId: jobRunId,
    };
    await protocol.mountPath(jobRunId, payload);

    logger.info(
      `[${jobRunId}] - Protocol: ${protocolType}, Hostname: ${hostname}, Path: ${path}`,
    );
    logger.info(
      `[${jobRunId}] - [${protocolType}] Worker ${workerId} is being set up for ${hostname}/${path}`,
    );

    const workerConfigUrl = WorkersConfig.get('workerConfigUrl');
    const activeWorkerIds = [workerId];
    logger.info(`[${jobRunId}] - Worker config URL: ${workerConfigUrl}`);
    logger.info(
      `[${jobRunId}] - Active workers: ${JSON.stringify(activeWorkerIds)}, Control Plan URL: ${workerConfigUrl}`,
    );

    await axios.post(`${workerConfigUrl}update/configs`, {
      jobRunId: jobRunId,
      workerIds: activeWorkerIds,
    });

    logger.info(`[${jobRunId}] - Control plane notified about active workers.`);

    return {
      jobRunId,
      status: 'success',
      protocolType,
      hostname,
      workerId,
      message: `[${jobRunId}] - Worker ${workerId} successfully set up for ${hostname}/${path}`,
    };
  } catch (error) {
    logger.error(
      `[${jobRunId}] - Failed to set up worker ${workerId}: ${error.message}`,
    );
    return {
      jobRunId,
      status: 'error',
      protocolType: null,
      hostname: null,
      workerId,
      message: `[${jobRunId}] - Worker setup failed: ${error.message}`,
    };
  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info(`[${jobRunId}] - Redis client connection closed.`);
    }
  }
}

export async function cleanup(jobRunId: string): Promise<any> {
  const logger = new Logger();
  const workerId = WorkersConfig.get('workerId');
  let redisClient = null;

  redisClient = await RedisUtils.getClient();
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info(`[${jobRunId}] - Redis client connected cleaning up worker`);
  }
  const contextProvider = JobContextFactory.getProvider('redis', redisClient);
  const context = await contextProvider.getJobContext(jobRunId);
  logger.info('Job Context' + JSON.stringify(context.jobConfig));

  if (!context) {
    logger.error(`[${jobRunId}] - Context not found for traceId ${jobRunId}`);
    return {
      jobRunId,
      status: 'error',
      protocolType: null,
      hostname: null,
      workerId,
      message: `[${jobRunId}] - Could not find context for traceId ${jobRunId}`,
    };
  }

  const protocolType = context.jobConfig.sourceFileServer.protocols[0].type;
  const protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
  const hostname = context.jobConfig.sourceFileServer.hostname;
  const { pathId, path, workingDirectory } = context.jobConfig.sourceFileServer;
  logger.info(`hostname , ${hostname}`);
  const payload = {
    hostname: hostname,
    username: 'root',
    password: '',
    path: path,
    workingDirectory: workingDirectory,
    pathId: pathId,
    jobRunId: jobRunId,
  };
  logger.info(
    `[${jobRunId}] - [${protocolType}] Cleaning up worker ${workerId} for ${payload.hostname}/${payload.path}`,
  );

  try {
    const protocol: Protocol = Protocols.getProtocol(
      ProtocolTypes[protocolType],
    );
    await protocol.unmountPath(jobRunId, payload);

    logger.info(
      `[${jobRunId}] - [${protocolType}] Worker ${workerId} cleanup successfully completed for ${payload.hostname}/${payload.path}`,
    );

    return {
      jobRunId,
      status: 'success',
      protocolType,
      hostname: payload.hostname,
      workerId,
      message: `[${jobRunId}] - Worker cleanup successfully completed for ${payload.hostname}/${payload.path}`,
    };
  } catch (error) {
    logger.error(
      `[${jobRunId}] - [${protocolType}] Failed to cleanup worker ${workerId}: ${error.message}`,
    );

    return {
      jobRunId,
      status: 'error',
      protocolType,
      hostname: payload.hostname,
      workerId,
      message: `[${jobRunId}] - Worker cleanup failed: ${error.message}`,
    };
  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info(`[${jobRunId}] - Redis client connection closed.`);
    }
  }
}
