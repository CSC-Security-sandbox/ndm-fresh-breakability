# NetApp Cloud Data Migrate (NDM)

## Overview

NetApp Cloud Data Migrate (NDM) is a comprehensive data migration solution that facilitates seamless data transfer between different storage systems and cloud environments.

## Components

### API Handler Library

The API Handler Library standardizes API responses and error handling for NestJS applications within the NDM ecosystem. It provides a consistent structure for both success and error responses, making it easier for frontend applications to process API responses.

#### Features

- Standardized response format for all API endpoints
- Consistent error handling with appropriate HTTP status codes
- Custom success and error messages based on API endpoints
- Request tracking with unique IDs
- Support for pagination metadata

#### Installation

```bash
$ npm install @netapp-cloud-datamigrate/api-handler-lib
```

#### Configuration

This library uses a NetApp-Cloud-DataMigrate npm registry at `https://npm.pkg.github.com`. Make sure this registry is running and accessible when publishing or installing the library.

Add the following to your `.npmrc` file:

```
@NetApp-Cloud-DataMigrate:registry=https://npm.pkg.github.com
```

#### Usage

1. Import the module in your NestJS application:

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import responseHandlerConfig from '@netapp-cloud-datamigrate/api-handler-lib';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [responseHandlerConfig],
    }),
    // other modules
  ],
  // ...
})
export class AppModule {}
```

2. Define custom success and error DTOs:

```typescript
// success-messages.ts
import { CustomSuccessDTO } from '@netapp-cloud-datamigrate/api-handler-lib';

export const successDTOList: CustomSuccessDTO[] = [
  {
    apiEndPointKey: 'users',
    method: 'GET',
    message: 'Users retrieved successfully',
    statusCode: '200'
  },
  {
    apiEndPointKey: 'create-user',
    method: 'POST',
    message: 'User created successfully',
    statusCode: '201'
  },
  // Add more success DTOs as needed
];
```

```typescript
// error-messages.ts
import { CustomErrorDTO } from '@NetApp-Cloud-DataMigrate/api-handler-lib';

export const errorDTOList: CustomErrorDTO[] = [
  {
    apiEndPointKey: 'users',
    message: 'Failed to retrieve users',
    statusCode: '500',
    correctiveAction: 'Please try again later'
  },
  {
    apiEndPointKey: 'create-user',
    message: 'Failed to create user',
    statusCode: '400',
    correctiveAction: 'Please check your input data and try again'
  },
  // Add more error DTOs as needed
];
```

3. Use the ResponseInterceptor in your controllers:

```typescript
// users.controller.ts
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ResponseInterceptor } from '@netapp-cloud-datamigrate/api-handler-lib';
import { successDTOList } from './success-messages';
import { errorDTOList } from './error-messages';
import { UsersService } from './users.service';

@Controller('users')
@UseInterceptors(new ResponseInterceptor(successDTOList, errorDTOList))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // other controller methods
}
```

4. Global usage with APP_INTERCEPTOR:

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from '@netapp-cloud-datamigrate/api-handler-lib';
import { successDTOList } from './success-messages';
import { errorDTOList } from './error-messages';

@Module({
  // ...
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useValue: new ResponseInterceptor(successDTOList, errorDTOList),
    },
  ],
})
export class AppModule {}
```

#### Response Format

##### Success Response

```json
{
  "trackId": "unique-request-id",
  "message": "Users retrieved successfully",
  "data": {
    "items": [
      { "id": 1, "name": "John Doe" },
      { "id": 2, "name": "Jane Smith" }
    ],
    "meta": {
      "total": 100,
      "page": 1,
      "pageSize": 10,
      "hasMore": true
    }
  }
}
```

##### Error Response

```json
{
  "trackId": "unique-request-id",
  "message": "Failed to create user",
  "error": {
    "code": "400",
    "message": "Failed to create user",
    "correctiveAction": "Please check your input data and try again"
  }
}
```

## Services

The NDM ecosystem consists of several services:

- Admin Service
- Config Service
- Datamigrator UI
- DB Writer
- Jobs Service
- Reports Service
- Worker

Each service has its own README.md with specific documentation.

## Libraries

NDM includes several libraries:

- API Handler Library (described above)
- Auth Library
- Logger Library

## Getting Started

Please refer to the individual service and library README.md files for specific setup and usage instructions.

## License

ISC