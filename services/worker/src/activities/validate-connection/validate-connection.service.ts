import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'util';
import { exec } from 'child_process';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

const execAsync = promisify(exec);

@Injectable()
export class ValidateConnectionActivity {
  private readonly logger: LoggerService;
  readonly workerId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.logger = loggerFactory.create(ValidateConnectionActivity.name);
  }

  async validate(traceId: string, protocolType: string, payload: any, feature: any): Promise<any> {
    this.logger.log(
      `[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${this.workerId}`,
    );
    const response = {
      traceId: traceId,
      status: 'success',
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: this.workerId,
      paths: [],
      protocolVersions: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`,
    };
    try {
      const protocol: Protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
      if (protocolType === ProtocolTypes.SMB && payload.adServerIp) {
        await this.configureSmbAdDns(traceId, payload.adServerIp);
      }
      await protocol.validateConnection(traceId, payload);
      if (feature.enablePreListPath) {
        response.paths = await protocol.listPaths(traceId, payload);
      }
      if (feature.enableVersionFetch) {
        response.protocolVersions = await protocol.getProtocolVersions(traceId, payload);
      }
      // if(protocolType === ProtocolTypes.SMB) {
      //   this.logger.log(`[${traceId}] disconnecting session for SMB`);
      //   const disconnectResponse = await protocol.disconnectSession(traceId, payload);
      //   this.logger.log(`[${traceId}] Disconnect response: ${disconnectResponse}`);
      // }
      this.logger.log(`[${traceId}] Paths: ${response.paths}`);
      return response;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        protocolType: protocolType,
        hostname: payload.hostname,
        workerId: this.workerId,
        paths: [],
        protocolVersions: [],
        message: `Failed to validate connection for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    }
  }
  
  private async configureSmbAdDns(traceId: string, dnsServerIp: string): Promise<void> {
    if (process.platform !== 'win32') return;
    try {
      const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);
      if (stdout.includes(dnsServerIp)) {
        this.logger.log(`[${traceId}] AD DNS ${dnsServerIp} already configured, skipping`);
        return;
      }
      await execAsync(`netsh interface ip add dns name="Ethernet" addr=${dnsServerIp} index=1 validate=no`);
      this.logger.log(`[${traceId}] AD DNS ${dnsServerIp} inserted at index=1 in adapter DNS list`);
    } catch (error) {
      this.logger.warn(`[${traceId}] Failed to configure AD DNS ${dnsServerIp}: ${error.message}`);
    }
  }
}
