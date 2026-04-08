import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WindowsPrivilegeService } from 'src/protocols/smb/windows-privilege.service';

@Injectable()
export class ValidateConnectionActivity {
  private readonly logger: LoggerService;
  readonly workerId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols,
    private readonly windowsPrivilegeService: WindowsPrivilegeService,
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
      warnings: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`,
    };
    const protocol: Protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
    try {
      await protocol.validateConnection(traceId, payload);

      if (protocolType === ProtocolTypes.SMB) {
        const membershipResult = await this.windowsPrivilegeService.checkBackupOperatorMembership(
          traceId, payload.username, payload.password,
        );
        if (membershipResult === 'NOT_DOMAIN_JOINED' || membershipResult === 'ERROR') {
          response.warnings.push('BACKUP_OPERATORS_CHECK_SKIPPED');
        } else if (membershipResult === 'NOT_MEMBER') {
          response.warnings.push('BACKUP_OPERATORS_NOT_MEMBER');
        }
      }
      if (feature.enablePreListPath) {
        response.paths = await protocol.listPaths(traceId, payload);
      }
      if (feature.enableVersionFetch) {
        response.protocolVersions = await protocol.getProtocolVersions(traceId, payload);
      }
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
        warnings: [],
        message: `Failed to validate connection for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    } finally {
      if (protocolType === ProtocolTypes.SMB) {
        try {
          this.logger.log(`[${traceId}] disconnecting session for SMB`);
          const disconnectResponse = await protocol.disconnectSession(traceId, payload);
          this.logger.log(`[${traceId}] Disconnect response: ${disconnectResponse}`);
        } catch (disconnectError) {
          this.logger.warn(`[${traceId}] Failed to disconnect SMB session (non-fatal): ${disconnectError.message}`);
        }
      }
    }
  }
}
