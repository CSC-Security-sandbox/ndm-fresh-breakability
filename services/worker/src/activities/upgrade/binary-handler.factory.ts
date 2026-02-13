import { IBinaryHandler } from './binary-handler.interface';
import { LinuxBinaryHandler } from './handlers/linux-binary.handler';
import { WindowsBinaryHandler } from './handlers/windows-binary.handler';

export class BinaryHandlerFactory {
  /**
   * Create a binary handler for the specified platform
   * @param platform - 'linux' or 'windows'
   * @returns Platform-specific IBinaryHandler implementation
   */
  static create(platform: 'linux' | 'windows'): IBinaryHandler {
    switch (platform) {
      case 'linux':
        return new LinuxBinaryHandler();
      case 'windows':
        return new WindowsBinaryHandler();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
