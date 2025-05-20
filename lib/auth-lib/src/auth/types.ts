
export interface Role {
  role_name: string;
  projects: string[];
  permissions: string[]
}

export interface User {
  roles: Role[]
}

export interface DecodedToken {
    iss: string;
    sub: string;
    aud: string | string[];
    iat: number;
    exp: number;
    scope?: string;
    azp?: string;
    user?: User
    [key: string]: any;
  }