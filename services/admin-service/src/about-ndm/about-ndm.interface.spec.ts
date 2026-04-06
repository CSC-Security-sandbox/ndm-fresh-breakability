import { AboutNdmResponse } from './about-ndm.interface';

describe('AboutNdmResponse Interface', () => {
  it('should allow valid AboutNdmResponse objects', () => {
    const validResponse: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'Preview',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: '1.0.1',
          time: null,
        },
        controlPlane_version: {
          version: '1.0.0',
          time: null,
        },
      },
      contact: {
        email: 'test@netapp.com',
        phone: null,
        website: null,
      },
    };

    expect(validResponse).toBeDefined();
    expect(validResponse.build.controlPlane_version.version).toBe('1.0.0');
    expect(validResponse.build.worker_version.version).toBe('1.0.1');
    expect(validResponse.product.name).toBe('NDM');
    expect(validResponse.contact.email).toBe('test@netapp.com');
  });

  it('should allow unknown values', () => {
    const unknownResponse: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'Preview',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: 'unknown',
          time: null,
        },
        controlPlane_version: {
          version: 'unknown',
          time: null,
        },
      },
      contact: {
        email: 'niharika@netapp.com',
        phone: null,
        website: null,
      },
    };

    expect(unknownResponse).toBeDefined();
    expect(unknownResponse.build.controlPlane_version.version).toBe('unknown');
    expect(unknownResponse.build.worker_version.version).toBe('unknown');
  });

  it('should allow empty string values', () => {
    const emptyResponse: AboutNdmResponse = {
      product: {
        name: '',
        version: '',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: '',
          time: null,
        },
        controlPlane_version: {
          version: '',
          time: null,
        },
      },
      contact: {
        email: '',
        phone: null,
        website: null,
      },
    };

    expect(emptyResponse).toBeDefined();
    expect(emptyResponse.build.controlPlane_version.version).toBe('');
    expect(emptyResponse.build.worker_version.version).toBe('');
  });

  it('should allow mixed version values', () => {
    const mixedResponse: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'Beta',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: 'unknown',
          time: null,
        },
        controlPlane_version: {
          version: '2.0.0',
          time: null,
        },
      },
      contact: {
        email: 'support@netapp.com',
        phone: null,
        website: 'https://netapp.com',
      },
    };

    expect(mixedResponse).toBeDefined();
    expect(mixedResponse.build.controlPlane_version.version).toBe('2.0.0');
    expect(mixedResponse.build.worker_version.version).toBe('unknown');
  });

  it('should accept version strings with alpha-numeric and special characters', () => {
    const response: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'v1.0.0-alpha',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: 'v1.2.3-beta.1',
          time: '2023-01-01T00:00:00Z',
        },
        controlPlane_version: {
          version: 'v1.2.3-alpha',
          time: '2023-01-01T00:00:00Z',
        },
      },
      contact: {
        email: 'dev@netapp.com',
        phone: '+1-800-123-4567',
        website: 'https://support.netapp.com',
      },
    };

    expect(typeof response.build.controlPlane_version.version).toBe('string');
    expect(typeof response.build.worker_version.version).toBe('string');
  });

  it('should maintain all required properties', () => {
    const response: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'Production',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: '1.0.0',
          time: null,
        },
        controlPlane_version: {
          version: '1.0.0',
          time: null,
        },
      },
      contact: {
        email: 'niharika@netapp.com',
        phone: null,
        website: null,
      },
    };

    expect(response).toHaveProperty('product');
    expect(response).toHaveProperty('build');
    expect(response).toHaveProperty('contact');
    expect(response.build).toHaveProperty('worker_version');
    expect(response.build).toHaveProperty('controlPlane_version');
  });

  it('should support semantic versioning format', () => {
    const semanticVersionResponse: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'GA',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: '1.2.3-rc.1+build.456',
          time: '2023-06-15T10:30:00Z',
        },
        controlPlane_version: {
          version: '1.2.3-alpha.1+build.123',
          time: '2023-06-15T09:15:00Z',
        },
      },
      contact: {
        email: 'releases@netapp.com',
        phone: null,
        website: 'https://docs.netapp.com',
      },
    };

    expect(semanticVersionResponse.build.controlPlane_version.version).toMatch(
      /^\d+\.\d+\.\d+/,
    );
    expect(semanticVersionResponse.build.worker_version.version).toMatch(
      /^\d+\.\d+\.\d+/,
    );
  });

  it('should be serializable to JSON and deserializable', () => {
    const originalResponse: AboutNdmResponse = {
      product: {
        name: 'NDM',
        version: 'Release',
        serialId: 'N/A',
      },
      build: {
        worker_version: {
          version: '1.0.1',
          time: '2023-01-02T00:00:00Z',
        },
        controlPlane_version: {
          version: '1.0.0',
          time: '2023-01-01T00:00:00Z',
        },
      },
      contact: {
        email: 'api@netapp.com',
        phone: null,
        website: null,
      },
    };

    const serialized = JSON.stringify(originalResponse);
    const deserialized: AboutNdmResponse = JSON.parse(serialized);

    expect(deserialized.build.controlPlane_version.version).toBe('1.0.0');
    expect(deserialized.build.worker_version.version).toBe('1.0.1');
    expect(deserialized.product.name).toBe('NDM');
  });
});
