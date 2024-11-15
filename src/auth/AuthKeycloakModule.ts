import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import keycloakConfig from '../config/keycloak.config';
import { JwtAuthGuard } from './JwtAuthGuard';
import { JwtService } from './JwtService';

@Module({
    imports: [    
        ConfigModule.forRoot({ load: [keycloakConfig] }),
    ],
    providers: [JwtService, JwtAuthGuard],
    exports: [JwtService, JwtAuthGuard],
})
export class AuthKeycloakModule {}