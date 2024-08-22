import { Module } from '@nestjs/common';

import { CustomerModule } from './customer/customer.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessrelationModule } from './accessrelation/accessrelation.module';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb://localhost:27017/accounts-service'),
    CustomerModule, UsersModule, ProjectsModule, RolesModule, PermissionsModule, AccessrelationModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
