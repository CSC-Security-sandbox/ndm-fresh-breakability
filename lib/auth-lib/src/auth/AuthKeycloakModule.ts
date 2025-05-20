import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import keycloakConfig from '../config/keycloak.config';
import { JwtAuthGuard } from './JwtAuthGuard';
import { JwtService } from './JwtService';
import { JwtWorkerAuthGuard } from './jwtWorkerAuthGuard';

@Module({
    imports: [    
        ConfigModule.forRoot({ load: [keycloakConfig] }),
    ],
    providers: [JwtService, JwtAuthGuard, JwtWorkerAuthGuard],
    exports: [JwtService, JwtAuthGuard, JwtWorkerAuthGuard],
})
export class AuthKeycloakModule {}