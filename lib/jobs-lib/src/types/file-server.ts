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

  constructor(hostname: string, protocols: Protocol[],pathId: string, path:string,username?: string, password?:string,  workingDirectory?:string, protocolVersion?: string) {
    this.hostname = hostname;
    this.protocols = protocols;
    this.password = password;
    this.pathId = pathId;
    this.username = username;
    this.path = path;
    this.workingDirectory = workingDirectory;
    this.protocolVersion = protocolVersion
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
    this.protocolVersion = obj?.protocol
  }
}


export enum ProtocolType {
  SMB = 'SMB',
  NFS = 'NFS',
}

export abstract class Protocol implements Serializable {
  abstract type: string;
  protected username: string;
  protected password?: string;

  constructor(username: string, password?: string) {
    this.username = username;
    this.password = password;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  deserialize(json: string): void {
    const obj = JSON.parse(json);
    this.username = obj.username;
    this.password = obj.password;
  }
}

export class NFS extends Protocol {
  type: string = ProtocolType.NFS;
}

export class SMB extends Protocol {
  type: string = ProtocolType.SMB;
}

