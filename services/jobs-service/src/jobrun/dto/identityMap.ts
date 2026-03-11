import { IdentityMappings } from '@netapp-cloud-datamigrate/jobs-lib';

class IdentityMap extends IdentityMappings {
  init(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  close(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  cleanup(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
export default IdentityMap;
