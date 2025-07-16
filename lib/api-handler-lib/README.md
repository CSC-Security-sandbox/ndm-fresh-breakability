# API Handler Library

## Description

The API Handler Library standardizes API responses and error handling for NestJS applications. It provides a consistent
structure for both success and error responses, making it easier for frontend applications to process API responses.

## Features

- Standardized response format for all API endpoints
- Consistent error handling with appropriate HTTP status codes
- Custom success and error messages based on API endpoints
- Request tracking with unique IDs
- Support for pagination metadata

## Installation

```bash
$ npm install @netapp-cloud-datamigrate/api-handler-lib
```

## Configuration

This library uses a NetApp-Cloud-DataMigrate npm registry at `https://npm.pkg.github.com`. Make sure this registry is
running and accessible when publishing or installing the library.

Add the following to your `.npmrc` file:

```
@NetApp-Cloud-DataMigrate:registry=https://npm.pkg.github.com
```

## Usage

### 1. Import the module in your NestJS application

```typescript
// app.module.ts
import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
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
export class AppModule {
}
```

### 2. Define custom success and error DTOs

```typescript
// success-messages.ts
import {CustomSuccessDTO} from '@netapp-cloud-datamigrate/api-handler-lib';

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
import {CustomErrorDTO} from '@netapp-cloud-datamigrate/api-handler-lib';

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

### 3. Use the ResponseInterceptor in your controllers

```typescript
// users.controller.ts
import {Controller, Get, UseInterceptors} from '@nestjs/common';
import {ResponseInterceptor} from '@netapp-cloud-datamigrate/api-handler-lib';
import {successDTOList} from './success-messages';
import {errorDTOList} from './error-messages';
import {UsersService} from './users.service';

@Controller('users')
@UseInterceptors(new ResponseInterceptor(successDTOList, errorDTOList))
export class UsersController {
    constructor(private readonly usersService: UsersService) {
    }

    @Get()
    findAll() {
        return this.usersService.findAll();
    }

    // other controller methods
}
```

### 4. Global usage with APP_INTERCEPTOR

```typescript
// app.module.ts
import {Module} from '@nestjs/common';
import {APP_INTERCEPTOR} from '@nestjs/core';
import {ResponseInterceptor} from '@netapp-cloud-datamigrate/api-handler-lib';
import {successDTOList} from './success-messages';
import {errorDTOList} from './error-messages';

@Module({
    // ...
    providers: [
        {
            provide: APP_INTERCEPTOR,
            useValue: new ResponseInterceptor(successDTOList, errorDTOList),
        },
    ],
})
export class AppModule {
}
```

## Response Format

### Success Response

```json
{
  "trackId": "unique-request-id",
  "message": "Users retrieved successfully",
  "data": {
    "items": [
      {
        "id": 1,
        "name": "John Doe"
      },
      {
        "id": 2,
        "name": "Jane Smith"
      }
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

### Error Response

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

## Publishing Updates

When making changes to this library, follow these steps to ensure your changes are properly published and available to
consuming projects:

1. Make your changes to the library code
2. Update the version number in `package.json` (follow semantic versioning)
3. Build the library: `npm run build`
4. Publish the library: `npm publish`

## Consuming Projects

When updating to a new version of this library in a consuming project:

1. Update the version number in the project's `package.json`
2. Clear npm cache: `npm cache clean --force`
3. Install the updated package: `npm install`

## Troubleshooting

If updates to the library are not being reflected in consuming projects:

1. Ensure the version in the library's `package.json` has been incremented
2. Make sure the library was built before publishing (`npm run build`)
3. Check that the consuming project's `package.json` references the correct version
4. Clear npm cache in the consuming project: `npm cache clean --force`
5. Delete `node_modules` and `package-lock.json` in the consuming project if necessary
6. Run `npm install` in the consuming project

## Project setup

```bash
$ npm install
```

## Build the library

```bash
$ npm run build
```

## License

ISC