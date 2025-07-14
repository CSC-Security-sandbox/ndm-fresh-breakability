import { HealthcheckProviders } from './healthcheck.providers';
import { totalmem, freemem } from 'os';
import { cpu, drive } from 'node-os-utils';

describe('HealthcheckProviders', () => {
    it('should be an array with 4 providers', () => {
        expect(Array.isArray(HealthcheckProviders)).toBe(true);
        expect(HealthcheckProviders).toHaveLength(4);
    });

    it('should provide totalmem from os', () => {
        const provider = HealthcheckProviders.find(p => p.provide === 'totalmem');
        expect(provider).toBeDefined();
        expect(provider?.useValue).toBe(totalmem);
    });

    it('should provide freemem from os', () => {
        const provider = HealthcheckProviders.find(p => p.provide === 'freemem');
        expect(provider).toBeDefined();
        expect(provider?.useValue).toBe(freemem);
    });

    it('should provide cpu from node-os-utils', () => {
        const provider = HealthcheckProviders.find(p => p.provide === 'cpu');
        expect(provider).toBeDefined();
        expect(provider?.useValue).toBe(cpu);
    });

    it('should provide drive from node-os-utils', () => {
        const provider = HealthcheckProviders.find(p => p.provide === 'drive');
        expect(provider).toBeDefined();
        expect(provider?.useValue).toBe(drive);
    });
});