import { Platform } from "src/constants/enums";

export function generateWorkerName(workerNumber: number, platform: Platform): string {
    let prefix: string;
    switch (platform) {
      case Platform.LINUX:
      case Platform.MACOS:
        prefix = 'nfs-worker';
        break;

      case Platform.WINDOWS:
        prefix = 'smb-worker';
        break;

      default:
        prefix = 'generic-worker';
        break;
    }
    return `${prefix}-${workerNumber}`;
  }