import { Protocol } from './protocols';
import { Serializable } from './serializable';

export class FileServerDetails implements Serializable {
  hostname: string;
  protocols: Protocol[];

  constructor(hostname: string, protocols: Protocol[]) {
    this.hostname = hostname;
    this.protocols = protocols;
  }

  serialize(): string {
    return JSON.stringify(this);
  }

  deserialize(json: string): void {
    const obj = JSON.parse(json);
    this.hostname = obj.hostname;
    this.protocols = obj.protocols;
  }
}
