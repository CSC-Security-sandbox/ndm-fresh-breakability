import { Serializable } from "./serializable";

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
