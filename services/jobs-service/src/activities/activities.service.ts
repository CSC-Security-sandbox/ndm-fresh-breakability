import { Injectable } from '@nestjs/common';
import { ListDirsActivity, MountInput, ListDirsInput, StoreResultInput } from './list-dirs/list-dirs.activity';

@Injectable()
export class ActivitiesService {
  constructor(private readonly listDirsActivity: ListDirsActivity) {}

  async mountExportPath(input: MountInput): Promise<string> {
    return this.listDirsActivity.mountExportPath(input);
  }

  async listDirectories(input: ListDirsInput): Promise<{ name: string }[]> {
    return this.listDirsActivity.listDirectories(input);
  }

  async unmountExportPath(mountPath: string): Promise<void> {
    return this.listDirsActivity.unmountExportPath(mountPath);
  }

  async storeResultInRedis(input: StoreResultInput): Promise<void> {
    return this.listDirsActivity.storeResultInRedis(input);
  }
}