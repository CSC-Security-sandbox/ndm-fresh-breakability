import { SyncEmail, IncidentStatus } from './sync-email.entity';

describe('SyncEmail Entity', () => {
  let syncEmail: SyncEmail;
  const testUserId = '12345678-1234-1234-1234-123456789012';

  beforeEach(() => {
    syncEmail = new SyncEmail();
  });

  describe('Basic Properties', () => {
    it('should create an instance of SyncEmail', () => {
      expect(syncEmail).toBeInstanceOf(SyncEmail);
    });

    it('should have all required properties', () => {
      syncEmail.id = '11111111-1111-1111-1111-111111111111';
      syncEmail.mailContent = { subject: 'Test Subject', body: 'Test Body' };
      syncEmail.incidentStatus = IncidentStatus.OPEN;
      syncEmail.description = 'Test Description';
      syncEmail.summary = 'Test Summary';
      syncEmail.alertSource = 'Test Alert Source';
      syncEmail.alertName = 'Test Alert Name';

      expect(syncEmail.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(syncEmail.mailContent).toEqual({ subject: 'Test Subject', body: 'Test Body' });
      expect(syncEmail.incidentStatus).toBe(IncidentStatus.OPEN);
      expect(syncEmail.description).toBe('Test Description');
      expect(syncEmail.summary).toBe('Test Summary');
      expect(syncEmail.alertSource).toBe('Test Alert Source');
      expect(syncEmail.alertName).toBe('Test Alert Name');
    });
  });

  describe('Incident Status', () => {
    it('should accept valid IncidentStatus values', () => {
      syncEmail.incidentStatus = IncidentStatus.OPEN;
      expect(syncEmail.incidentStatus).toBe(IncidentStatus.OPEN);
      
      syncEmail.incidentStatus = IncidentStatus.CLOSED;
      expect(syncEmail.incidentStatus).toBe(IncidentStatus.CLOSED);
    });
  });

  describe('Mail Content', () => {
    it('should store and retrieve complex JSON data in mailContent', () => {
      const complexData = {
        subject: 'Alert: Server Down',
        sender: 'alerts@company.com',
        recipients: ['admin@company.com', 'support@company.com'],
        body: 'The server is experiencing issues',
        attachments: [
          { name: 'logs.txt', size: 1024 }
        ],
        metadata: {
          severity: 'high',
          category: 'infrastructure'
        }
      };
      
      syncEmail.mailContent = complexData;
      expect(syncEmail.mailContent).toEqual(complexData);
    });
  });

  describe('Inherited Base Properties', () => {
    it('should populate who columns correctly', () => {
      expect(syncEmail.created_by).toBeUndefined();
      expect(syncEmail.updated_by).toBeUndefined();
      
      syncEmail.populateWhoColumns(testUserId);
      expect(syncEmail.created_by).toBe(testUserId);
      expect(syncEmail.updated_by).toBe(testUserId);
      
      const newUserId = '87654321-8765-4321-8765-432109876543';
      syncEmail.populateWhoColumns(newUserId);
      expect(syncEmail.created_by).toBe(testUserId);
      expect(syncEmail.updated_by).toBe(newUserId);
    });
  });

  describe('Optional Properties', () => {
    it('should allow null for optional properties', () => {
      syncEmail.id = '11111111-1111-1111-1111-111111111111';
      syncEmail.mailContent = { subject: 'Test Subject' };
      syncEmail.incidentStatus = IncidentStatus.OPEN;
      
      expect(syncEmail.description).toBeUndefined();
      expect(syncEmail.summary).toBeUndefined();
      expect(syncEmail.alertSource).toBeUndefined();
      expect(syncEmail.alertName).toBeUndefined();
    });
  });
});