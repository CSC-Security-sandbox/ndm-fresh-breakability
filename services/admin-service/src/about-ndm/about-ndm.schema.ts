import { ApiProperty } from '@nestjs/swagger';

export class WorkerVersionSchema {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Worker build version',
    example: '1.2.3',
  })
  version: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Worker build time',
    example: '2025-01-20T10:30:00Z',
  })
  time: string | null;
}

export class ControlPlaneVersionSchema {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Control plane build version',
    example: '1.2.3',
  })
  version: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Control plane build time',
    example: '2025-01-20T10:30:00Z',
  })
  time: string | null;
}

export class ProductSchema {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Product name',
    example: 'NDM',
  })
  name: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Product version',
    example: 'Preview',
  })
  version: string | null;
}

export class BuildSchema {
  @ApiProperty({
    type: WorkerVersionSchema,
    description: 'Worker version information',
  })
  worker_version: WorkerVersionSchema;

  @ApiProperty({
    type: ControlPlaneVersionSchema,
    description: 'Control plane version information',
  })
  controlPlane_version: ControlPlaneVersionSchema;
}

export class ContactSchema {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Contact email',
    example: 'support@netapp.com',
  })
  email: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Contact phone',
    example: '+1-800-123-4567',
  })
  phone: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Contact website',
    example: 'https://www.netapp.com',
  })
  website: string | null;
}

export class AboutNdmResponseSchema {
  @ApiProperty({
    type: ProductSchema,
    description: 'Product information',
  })
  product: ProductSchema;

  @ApiProperty({
    type: BuildSchema,
    description: 'Build version information',
  })
  build: BuildSchema;

  @ApiProperty({
    type: ContactSchema,
    description: 'Contact information',
  })
  contact: ContactSchema;
}
