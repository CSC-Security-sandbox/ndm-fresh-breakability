import { CanActivate, ExecutionContext, Injectable, Logger, Inject, applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { Reflector } from '@nestjs/core';
import { JwtService } from "./JwtService";
import { DecodedToken } from "./types";
import { Permission } from "../constants/permission";




@Injectable()
export class JwtAuthGuard implements CanActivate {
    private logger: Logger = new Logger(JwtAuthGuard.name);

    constructor(
        @Inject(Reflector.name) 
        private readonly reflector: Reflector,
        private readonly jwtService: JwtService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const permissions = this.reflector.get<Permission[]>('permissions', context.getHandler());
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
            if(!decoded.user) return false;
            this.logger.debug(`Token decoded successfully`);
            request['user'] = decoded.user


            if(permissions.length > 0) {
                const project = request.headers.projectid
                for(const role of decoded.user.roles) {
                    if(role.projects.length === 0 || role.projects?.includes(project)) {
                        const permMap = new Set<string>(role.permissions)
                        for(const perm  of permissions){
                            if(!permMap.has(perm)) {
                                return false;
                            }
                        }
                        return true
                    }
                }
                // user has project in header but no permission match found
                return false
            }
            return true;
        } catch (error) {
            this.logger.error("Error verifying token:", error);
            return false;
        }
    }
}

export  function Auth(...permission: Permission[]) {
    return applyDecorators(
        SetMetadata('permissions', permission),
        UseGuards(JwtAuthGuard)
    )
}

