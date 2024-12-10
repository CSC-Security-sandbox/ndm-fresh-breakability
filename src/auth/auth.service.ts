import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPermissionResponse } from './user-permission-response-type';
import { makeAxiosRequest } from 'src/utils/axios-request-utils';
 
@Injectable()
export class AuthService {
 
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}
 
  public async getKeycloakToken() {
    try {
      const data = await makeAxiosRequest<{ access_token: string }>({
        method: "POST",
        url: `${process.env.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
        data: new URLSearchParams({
          client_id: process.env.KEYCLOAK_ADMIN_CLIENT,
          username: process.env.KEYCLOAK_ADMIN_USERNAME,
          password: process.env.KEYCLOAK_ADMIN_PASSWORD,
          grant_type: "password",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
  
      return data.access_token;
    } catch (error) {
      throw new InternalServerErrorException("Failed to get Keycloak token");
    }
  }
 
  private generateRandomPassword(length: number): string {
    const specialCharacters = "!@#$%^&*()-_=+[]{}|;:,.<>?";
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+[\]{}|;:,.<>?]).+$/;
 
    return Array.from({ length }, () =>
        crypto.randomBytes(1).toString("base64").replace(/[^a-zA-Z0-9]/g, () =>
            specialCharacters[Math.floor(Math.random() * specialCharacters.length)]
        )
    ).join("").slice(0, length).replace(/(.+)/, (pwd) => regex.test(pwd) ? pwd : this.generateRandomPassword(length));
}
 
  async inviteUser(
    username: string,
    firstName: string,
    lastName: string,
    userPermissionResponse: UserPermissionResponse
  ): Promise<{ user: User; tempPassword: string }> {
    const tempPassword = this.generateRandomPassword(12);
    const token = await this.getKeycloakToken();

    try {
      await makeAxiosRequest({
        method: "POST",
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        data: {
          username,
          enabled: true,
          firstName,
          lastName,
          email: username,
          credentials: [
            {
              type: "password",
              value: tempPassword,
              temporary: true,
            },
          ],
          requiredActions: ["UPDATE_PASSWORD"],
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const user = this.userRepository.create({
        email: username,
        user_status: "active",
        first_name: firstName,
        last_name: lastName,
      });

      user.populateWhoColumns(userPermissionResponse.user.id);
      const savedUser = await this.userRepository.save(user);

      return { user: savedUser, tempPassword };
    } catch (error) {
      throw new InternalServerErrorException("Failed to create user in Keycloak");
    }
  }


  async resetPassword(email: string): Promise<string> {
    const newPassword = this.generateRandomPassword(12);
    const token = await this.getKeycloakToken();
  
    try {
      const users = await makeAxiosRequest<any[]>({
        method: "GET",
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        headers: { Authorization: `Bearer ${token}` },
        params: { email },
      });
  
      const keycloakUser = users[0];
      if (!keycloakUser) {
        throw new NotFoundException("User not found in Keycloak");
      }
  
      await makeAxiosRequest({
        method: "PUT",
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}/reset-password`,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        data: {
          type: "password",
          value: newPassword,
          temporary: true,
        },
      });
  
      return newPassword;
    } catch (error) {
      throw new InternalServerErrorException("Failed to reset password in Keycloak, : error", error.message);
    }
  }
 
  async setUserStatus(email: string, enable: boolean): Promise<User> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
  
    user.user_status = enable ? "active" : "inactive";
    await this.userRepository.save(user);
  
    const token = await this.getKeycloakToken();
  
    try {
      const users = await makeAxiosRequest<any[]>({
        method: "GET",
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        headers: { Authorization: `Bearer ${token}` },
        params: { email },
      });
  
      if (users.length === 0) {
        throw new NotFoundException("User not found in Keycloak");
      }
  
      const keycloakUser = users[0];
      
      await makeAxiosRequest({
        method: "PUT",
        url: `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}`,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        data: { enabled: enable },
      });
  
      if (!enable) {
        await makeAxiosRequest({
          method: "OPTIONS",
          url: `${process.env.KEYCLOAK_BASE_URL}/${process.env.KEYCLOAK_REALM}/users/${(keycloakUser.id).toString().trim()}/logout`,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
  
      return user;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to update user status in Keycloak, error: ${error.message}`
      );
    }
  }
}