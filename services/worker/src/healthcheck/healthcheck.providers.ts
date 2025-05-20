import { totalmem, freemem } from 'os';
import { cpu, drive } from 'node-os-utils';

export const HealthcheckProviders = [
  {
    provide: 'totalmem',
    useValue: totalmem,
  },
  {
    provide: 'freemem',
    useValue: freemem,
  },
  {
    provide: 'cpu',
    useValue: cpu,
  },
  {
    provide: 'drive',
    useValue: drive,
  },
];
