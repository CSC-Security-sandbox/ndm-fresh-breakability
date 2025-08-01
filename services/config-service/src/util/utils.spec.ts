import { generateWorkerName } from './utils';
import { Platform } from 'src/constants/enums';

describe('generateWorkerName', () => {
    it('should return nfs-worker prefix for LINUX platform', () => {
        expect(generateWorkerName(1, Platform.LINUX)).toBe('nfs-worker-1');
        expect(generateWorkerName(42, Platform.LINUX)).toBe('nfs-worker-42');
    });

    it('should return nfs-worker prefix for MACOS platform', () => {
        expect(generateWorkerName(2, Platform.MACOS)).toBe('nfs-worker-2');
    });

    it('should return smb-worker prefix for WINDOWS platform', () => {
        expect(generateWorkerName(3, Platform.WINDOWS)).toBe('smb-worker-3');
    });

    it('should return generic-worker prefix for unknown platform', () => {
        // @ts-expect-error: Testing with an invalid platform value
        expect(generateWorkerName(4, 'UNKNOWN')).toBe('generic-worker-4');
        expect(generateWorkerName(5, undefined)).toBe('generic-worker-5');
    });
});