import {
  WorkerVersionSchema,
  ControlPlaneVersionSchema,
  ProductSchema,
  BuildSchema,
  ContactSchema,
  AboutNdmResponseSchema,
} from './about-ndm.schema';

describe('AboutNdm Schema Classes', () => {
  describe('WorkerVersionSchema', () => {
    it('should be defined', () => {
      expect(WorkerVersionSchema).toBeDefined();
    });

    it('should create instance with null values', () => {
      const workerVersion = new WorkerVersionSchema();
      workerVersion.version = null;
      workerVersion.time = null;

      expect(workerVersion.version).toBeNull();
      expect(workerVersion.time).toBeNull();
    });

    it('should create instance with string values', () => {
      const workerVersion = new WorkerVersionSchema();
      workerVersion.version = '1.2.3';
      workerVersion.time = '2025-01-20T10:30:00Z';

      expect(workerVersion.version).toBe('1.2.3');
      expect(workerVersion.time).toBe('2025-01-20T10:30:00Z');
    });

    it('should have correct property types', () => {
      const workerVersion = new WorkerVersionSchema();
      workerVersion.version = 'test-version';
      workerVersion.time = 'test-time';

      expect(typeof workerVersion.version).toBe('string');
      expect(typeof workerVersion.time).toBe('string');
    });
  });

  describe('ControlPlaneVersionSchema', () => {
    it('should be defined', () => {
      expect(ControlPlaneVersionSchema).toBeDefined();
    });

    it('should create instance with null values', () => {
      const controlPlaneVersion = new ControlPlaneVersionSchema();
      controlPlaneVersion.version = null;
      controlPlaneVersion.time = null;

      expect(controlPlaneVersion.version).toBeNull();
      expect(controlPlaneVersion.time).toBeNull();
    });

    it('should create instance with string values', () => {
      const controlPlaneVersion = new ControlPlaneVersionSchema();
      controlPlaneVersion.version = '2.0.1';
      controlPlaneVersion.time = '2025-01-21T15:45:00Z';

      expect(controlPlaneVersion.version).toBe('2.0.1');
      expect(controlPlaneVersion.time).toBe('2025-01-21T15:45:00Z');
    });

    it('should have correct property types', () => {
      const controlPlaneVersion = new ControlPlaneVersionSchema();
      controlPlaneVersion.version = 'control-version';
      controlPlaneVersion.time = 'control-time';

      expect(typeof controlPlaneVersion.version).toBe('string');
      expect(typeof controlPlaneVersion.time).toBe('string');
    });
  });

  describe('ProductSchema', () => {
    it('should be defined', () => {
      expect(ProductSchema).toBeDefined();
    });

    it('should create instance with null values', () => {
      const product = new ProductSchema();
      product.name = null;
      product.version = null;

      expect(product.name).toBeNull();
      expect(product.version).toBeNull();
    });

    it('should create instance with string values', () => {
      const product = new ProductSchema();
      product.name = 'NDM';
      product.version = 'Preview';

      expect(product.name).toBe('NDM');
      expect(product.version).toBe('Preview');
    });

    it('should have correct property types', () => {
      const product = new ProductSchema();
      product.name = 'TestProduct';
      product.version = 'v1.0';

      expect(typeof product.name).toBe('string');
      expect(typeof product.version).toBe('string');
    });
  });

  describe('BuildSchema', () => {
    it('should be defined', () => {
      expect(BuildSchema).toBeDefined();
    });

    it('should create instance with worker and control plane versions', () => {
      const workerVersion = new WorkerVersionSchema();
      workerVersion.version = '1.0.0';
      workerVersion.time = '2025-01-20T10:00:00Z';

      const controlPlaneVersion = new ControlPlaneVersionSchema();
      controlPlaneVersion.version = '1.1.0';
      controlPlaneVersion.time = '2025-01-20T11:00:00Z';

      const build = new BuildSchema();
      build.worker_version = workerVersion;
      build.controlPlane_version = controlPlaneVersion;

      expect(build.worker_version).toBe(workerVersion);
      expect(build.controlPlane_version).toBe(controlPlaneVersion);
      expect(build.worker_version.version).toBe('1.0.0');
      expect(build.controlPlane_version.version).toBe('1.1.0');
    });

    it('should handle nested schema objects', () => {
      const build = new BuildSchema();
      build.worker_version = new WorkerVersionSchema();
      build.controlPlane_version = new ControlPlaneVersionSchema();

      build.worker_version.version = 'worker-v1';
      build.worker_version.time = 'worker-time';
      build.controlPlane_version.version = 'control-v1';
      build.controlPlane_version.time = 'control-time';

      expect(build.worker_version).toBeInstanceOf(WorkerVersionSchema);
      expect(build.controlPlane_version).toBeInstanceOf(
        ControlPlaneVersionSchema,
      );
    });
  });

  describe('ContactSchema', () => {
    it('should be defined', () => {
      expect(ContactSchema).toBeDefined();
    });

    it('should create instance with null values', () => {
      const contact = new ContactSchema();
      contact.email = null;
      contact.phone = null;
      contact.website = null;

      expect(contact.email).toBeNull();
      expect(contact.phone).toBeNull();
      expect(contact.website).toBeNull();
    });

    it('should create instance with string values', () => {
      const contact = new ContactSchema();
      contact.email = 'support@netapp.com';
      contact.phone = '+1-800-123-4567';
      contact.website = 'https://www.netapp.com';

      expect(contact.email).toBe('support@netapp.com');
      expect(contact.phone).toBe('+1-800-123-4567');
      expect(contact.website).toBe('https://www.netapp.com');
    });

    it('should have correct property types', () => {
      const contact = new ContactSchema();
      contact.email = 'test@example.com';
      contact.phone = '123-456-7890';
      contact.website = 'https://example.com';

      expect(typeof contact.email).toBe('string');
      expect(typeof contact.phone).toBe('string');
      expect(typeof contact.website).toBe('string');
    });

    it('should handle mixed null and string values', () => {
      const contact = new ContactSchema();
      contact.email = 'test@example.com';
      contact.phone = null;
      contact.website = 'https://example.com';

      expect(contact.email).toBe('test@example.com');
      expect(contact.phone).toBeNull();
      expect(contact.website).toBe('https://example.com');
    });
  });

  describe('AboutNdmResponseSchema', () => {
    it('should be defined', () => {
      expect(AboutNdmResponseSchema).toBeDefined();
    });

    it('should create complete response schema instance', () => {
      const product = new ProductSchema();
      product.name = 'NDM';
      product.version = 'Preview';

      const workerVersion = new WorkerVersionSchema();
      workerVersion.version = '1.0.0';
      workerVersion.time = '2025-01-20T10:00:00Z';

      const controlPlaneVersion = new ControlPlaneVersionSchema();
      controlPlaneVersion.version = '1.1.0';
      controlPlaneVersion.time = '2025-01-20T11:00:00Z';

      const build = new BuildSchema();
      build.worker_version = workerVersion;
      build.controlPlane_version = controlPlaneVersion;

      const contact = new ContactSchema();
      contact.email = 'support@netapp.com';
      contact.phone = '+1-800-123-4567';
      contact.website = 'https://www.netapp.com';

      const response = new AboutNdmResponseSchema();
      response.product = product;
      response.build = build;
      response.contact = contact;

      expect(response.product).toBe(product);
      expect(response.build).toBe(build);
      expect(response.contact).toBe(contact);
    });

    it('should have correct nested schema types', () => {
      const response = new AboutNdmResponseSchema();
      response.product = new ProductSchema();
      response.build = new BuildSchema();
      response.contact = new ContactSchema();

      expect(response.product).toBeInstanceOf(ProductSchema);
      expect(response.build).toBeInstanceOf(BuildSchema);
      expect(response.contact).toBeInstanceOf(ContactSchema);
    });

    it('should handle complete response structure with all data', () => {
      const response = new AboutNdmResponseSchema();

      // Initialize product
      response.product = new ProductSchema();
      response.product.name = 'NDM';
      response.product.version = 'Preview';

      // Initialize build
      response.build = new BuildSchema();
      response.build.worker_version = new WorkerVersionSchema();
      response.build.worker_version.version = '1.2.3';
      response.build.worker_version.time = '2025-01-20T10:30:00Z';

      response.build.controlPlane_version = new ControlPlaneVersionSchema();
      response.build.controlPlane_version.version = '1.2.4';
      response.build.controlPlane_version.time = '2025-01-20T11:00:00Z';

      // Initialize contact
      response.contact = new ContactSchema();
      response.contact.email = 'niharika@netapp.com';
      response.contact.phone = null;
      response.contact.website = null;

      // Verify complete structure
      expect(response.product.name).toBe('NDM');
      expect(response.product.version).toBe('Preview');
      expect(response.build.worker_version.version).toBe('1.2.3');
      expect(response.build.controlPlane_version.version).toBe('1.2.4');
      expect(response.contact.email).toBe('niharika@netapp.com');
      expect(response.contact.phone).toBeNull();
    });

    it('should handle response structure with null/N/A values', () => {
      const response = new AboutNdmResponseSchema();

      // Initialize with N/A values (as service returns)
      response.product = new ProductSchema();
      response.product.name = 'NDM';
      response.product.version = 'Preview';

      response.build = new BuildSchema();
      response.build.worker_version = new WorkerVersionSchema();
      response.build.worker_version.version = 'N/A';
      response.build.worker_version.time = null;

      response.build.controlPlane_version = new ControlPlaneVersionSchema();
      response.build.controlPlane_version.version = 'N/A';
      response.build.controlPlane_version.time = null;

      response.contact = new ContactSchema();
      response.contact.email = 'niharika@netapp.com';
      response.contact.phone = null;
      response.contact.website = null;

      expect(response.build.worker_version.version).toBe('N/A');
      expect(response.build.controlPlane_version.version).toBe('N/A');
      expect(response.build.worker_version.time).toBeNull();
      expect(response.build.controlPlane_version.time).toBeNull();
    });
  });
});
