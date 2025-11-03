import { CanActivate, ExecutionContext, Injectable, Logger, Inject, applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { Reflector } from '@nestjs/core';
import { JwtService } from "./JwtService";
import { DecodedToken } from "./types";




@Injectable()
export class JwtWorkerAuthGuard implements CanActivate {
    private logger: Logger = new Logger(JwtWorkerAuthGuard.name);

    constructor(
        @Inject(Reflector.name) 
        private readonly reflector: Reflector,
        private readonly jwtService: JwtService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Authorization header is missing.");
            return false;
        }
        const token = authHeader.split(' ')?.[1];
        if (!token) {
            this.logger.warn("JWT token is missing.");
            return false;
        }

        try {
            const decoded: DecodedToken = await this.jwtService.verifyToken(token);
            this.logger.debug(`Token decoded successfully`);
            if(!decoded.project_id){
                this.logger.debug(`Project id not found.`);
                return false;
            }

            request['project_id'] = decoded.project_id;
            request['worker_id'] = decoded.client_id;
            request['user'] = decoded; 

            return true;
        } catch (error) {
            this.logger.error("Error verifying token:", error);
            return false;
        }
    }
}
export  function AuthWorker() {
    return applyDecorators(
        UseGuards(JwtWorkerAuthGuard)
    )
}
