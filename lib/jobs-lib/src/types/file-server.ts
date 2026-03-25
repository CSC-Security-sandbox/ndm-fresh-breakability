import { Protocol } from './protocols';
import { Serializable } from './serializable';

export class FileServerDetails implements Serializable {
  hostname: string;
  protocols: Protocol[];
  password:string;
  pathId: string;
  username: string;
  path:string;
  workingDirectory:string;
  protocolVersion: string;
  dnsServer?: string;



  constructor(hostname: string, protocols: Protocol[], pathId: string, path: string, username?: string, password?: string, workingDirectory?: string, protocolVersion?: string, dnsServer?: string) {
    this.hostname = hostname;
    this.protocols = protocols;
    this.password = password;
    this.pathId = pathId;
    this.username = username;
    this.path = path;
    this.workingDirectory = workingDirectory;
    this.protocolVersion = protocolVersion;
    this.dnsServer = dnsServer;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  deserialize(json: string): void {
    const obj = JSON.parse(json);
    this.hostname = obj.hostname;
    this.protocols = obj.protocols;
    this.password = obj?.password;
    this.pathId = obj?.pathId;
    this.username = obj?.username;
    this.path = obj?.path;
    this.workingDirectory = obj?.workingDirectory;
    this.protocolVersion = obj?.protocol;
    this.dnsServer = obj?.dnsServer;
  }
}
