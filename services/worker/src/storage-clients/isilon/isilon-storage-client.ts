import { Inject, Injectable } from '@nestjs/common';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { StorageClient, SmartConnectFileServer } from '../storage-client';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Dell Isilon/PowerScale storage client implementation
 * Implements storage-specific operations for Isilon systems
 */
@Injectable()
export class IsilonStorageClient extends StorageClient {

  constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
    super(loggerFactory.create(IsilonStorageClient.name));
  }

  /**
   * Configure DNS resolver for Dell Isilon SmartConnect FQDN resolution
   * Adds the SmartConnect SSIP as a nameserver for the SmartConnect DNS zone
   * Supports Linux, macOS, and Windows
   * 
   * @param traceId - Trace ID for logging
   * @param fileServer - FileServer object containing smartConnectSsip and smartConnectDnsZone
   * @returns true if DNS was configured, false if skipped (no SSIP/zone provided)
   */
  async configureSmartConnectDns(
    traceId: string,
    fileServer: SmartConnectFileServer
  ): Promise<boolean> {
    const { smartConnectSsip: ssip, smartConnectDnsZone: dnsZone } = fileServer;

    if (!ssip || !dnsZone) {
      return false;
    }

    this.logger.log(`[${traceId}] Configuring SmartConnect DNS: SSIP=${ssip}, Zone=${dnsZone}, Platform=${process.platform}`);

    try {
      switch (process.platform) {
        case 'linux':
          await this.configureLinuxDns(traceId, ssip, dnsZone);
          break;
        case 'darwin':
          await this.configureMacOSDns(traceId, ssip, dnsZone);
          break;
        case 'win32':
          await this.configureWindowsDns(traceId, ssip, dnsZone);
          break;
        default:
          throw new Error(`Unsupported platform for DNS configuration: ${process.platform}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to configure SmartConnect DNS: ${error.message}`);
      throw error;
    }
  }

  private async configureLinuxDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    const resolvConfPath = '/etc/resolv.conf';
    const nameserverEntry = `nameserver ${ssip}`;

    const currentContent = await this.readFileOrEmpty(resolvConfPath, traceId);

    if (currentContent.includes(nameserverEntry)) {
      this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured`);
      return;
    }

    const newContent = this.buildResolvConf(currentContent, ssip, dnsZone);
    await fsPromises.writeFile(resolvConfPath, newContent);

    this.logger.log(`[${traceId}] Linux: SmartConnect DNS configured successfully`);
  }

  private async configureMacOSDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    const resolverDir = '/etc/resolver';
    const resolverFile = path.join(resolverDir, dnsZone);

    try {
      const content = await fsPromises.readFile(resolverFile, 'utf-8');
      if (content.includes(ssip)) {
        this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured for ${dnsZone}`);
        return;
      }
    } catch {
      this.logger.log(`[${traceId}] Resolver file not found for ${dnsZone}, creating new one`);
    }

    await fsPromises.mkdir(resolverDir, { recursive: true });
    const resolverContent = `# SmartConnect DNS resolver for Dell Isilon\nnameserver ${ssip}\n`;
    await fsPromises.writeFile(resolverFile, resolverContent);

    this.logger.log(`[${traceId}] macOS: SmartConnect DNS configured at ${resolverFile}`);
  }

  private async configureWindowsDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    if (await this.isWindowsDnsConfigured(traceId, ssip, dnsZone)) {
      return;
    }

    const addCmd = `powershell -Command "Add-DnsClientNrptRule -Namespace '.${dnsZone}' -NameServers '${ssip}'"`;

    try {
      await execAsync(addCmd);
      this.logger.log(`[${traceId}] Windows: SmartConnect DNS NRPT rule added for ${dnsZone} -> ${ssip}`);
    } catch (addError) {
      this.logger.warn(`[${traceId}] Failed to add NRPT rule: ${addError.message}. Trying netsh fallback...`);
      await this.configureWindowsDnsViaNetsh(traceId, ssip);
    }
  }

  private async isWindowsDnsConfigured(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<boolean> {
    const checkCmd = `powershell -Command "Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq '.${dnsZone}' }"`;

    try {
      const { stdout } = await execAsync(checkCmd);
      if (stdout && stdout.trim()) {
        this.logger.log(`[${traceId}] SmartConnect DNS rule already exists for ${dnsZone}`);
        return true;
      }
    } catch (checkError) {
      this.logger.warn(`[${traceId}] PowerShell NRPT check failed: ${checkError.message}. Trying nslookup fallback...`);

      try {
        const { stdout: nslookupOut } = await execAsync(`nslookup ${dnsZone} ${ssip}`);
        if (nslookupOut && !nslookupOut.includes("can't find") && !nslookupOut.includes('NXDOMAIN')) {
          this.logger.log(`[${traceId}] SmartConnect DNS zone ${dnsZone} already resolves via ${ssip}`);
          return true;
        }
      } catch {
        this.logger.log(`[${traceId}] SmartConnect DNS rule not found for ${dnsZone}, creating new rule`);
      }
    }

    return false;
  }

  private async configureWindowsDnsViaNetsh(
    traceId: string,
    ssip: string
  ): Promise<void> {
    const netshCmd = `netsh interface ip add dns name="Ethernet" addr=${ssip} index=1`;

    try {
      await execAsync(netshCmd);
      this.logger.log(`[${traceId}] Windows: SmartConnect DNS added via netsh`);
    } catch (netshError) {
      throw new Error(`Could not configure DNS: ${netshError.message}`);
    }
  }

  private async readFileOrEmpty(
    filePath: string,
    traceId: string
  ): Promise<string> {
    try {
      return await fsPromises.readFile(filePath, 'utf-8');
    } catch {
      this.logger.warn(`[${traceId}] Could not read ${filePath}, will create new file`);
      return '';
    }
  }

  private buildResolvConf(currentContent: string, ssip: string, dnsZone: string): string {
    const lines = currentContent.split('\n').filter(line => line.trim());
    const result: string[] = [`nameserver ${ssip}`];
    let hasSearchLine = false;

    for (const line of lines) {
      if (line.startsWith('search ')) {
        result.push(line.includes(dnsZone) ? line : `${line} ${dnsZone}`);
        hasSearchLine = true;
      } else {
        result.push(line);
      }
    }

    if (!hasSearchLine) {
      result.push(`search ${dnsZone}`);
    }

    return result.join('\n') + '\n';
  }
}