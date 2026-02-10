import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccountModule } from './account/account.module';
import { PermissionModule } from './permission/permission.module';
import { RoleModule } from './role/role.module';
import { ProjectModule } from './project/project.module';
import { RolePermissionModule } from './role-permission/role-permission.module';
import { UserRoleModule } from './user-role/user-role.module';
import { AppConfigModule } from './config/config.module';
import { UserModule } from './user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { Project } from './entities/project.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { AuthModule } from './auth/auth.module';
import { WorkerRegistrationModule } from './worker-registration/worker-registration.module';
import { SettingModule } from './setting/setting.module';
import { GlobalSettings } from './entities/global-setting.entity';
import { EmailModule } from './email/email.module';
import {
  LoggerModule,
  RequestContextMiddleware,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AboutNdmModule } from './about-ndm/about-ndm.module';
import { UpgradeModule } from './upgrade/upgrade.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([
      User,
      Role,
      Project,
      Account,
      UserRole,
      Permission,
      RolePermission,
      GlobalSettings,
    ]),
    AppConfigModule,
    AccountModule,
    PermissionModule,
    RoleModule,
    UserModule,
    ProjectModule,
    RolePermissionModule,
    UserRoleModule,
    AuthModule,
    WorkerRegistrationModule,
    SettingModule,
    EmailModule,
    AboutNdmModule,
    UpgradeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule{
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
