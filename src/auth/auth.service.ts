import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import { User } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
 
@Injectable()
export class AuthService {
 
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}
 
  public async getKeycloakToken() {
    try {
      const response = await axios.post(
        `${process.env.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
        new URLSearchParams({
          client_id: process.env.KEYCLOAK_ADMIN_CLIENT,
          username: process.env.KEYCLOAK_ADMIN_USERNAME,
          password: process.env.KEYCLOAK_ADMIN_PASSWORD,
          grant_type: 'password',
        }),
      );
      return response.data.access_token;
    } catch (error) {
      throw new InternalServerErrorException('Failed to get Keycloak token');
    }
  }
 
  private generateRandomPassword(length: number): string {
    return crypto.randomBytes(length).toString('base64').slice(0, length);
  }
 
  async inviteUser(username: string, firstName: string, lastName: string): Promise<{ user: User; tempPassword: string }> {
    const tempPassword = this.generateRandomPassword(12);
 
    const token = await this.getKeycloakToken();
 
    try {
      const keycloakUser = await axios.post(
        `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        {
          username,
          enabled: true,
          firstName: firstName,
          lastName: lastName,
          email:username,
          credentials: [
            {
              type: 'password',
              value: tempPassword,
              temporary: true,
            },
          ],
          requiredActions: ["UPDATE_PASSWORD", "UPDATE_PROFILE"]
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
 
      const user = this.userRepository.create({
        email: `${username}`,
        user_status: 'active',
        first_name: firstName,
        last_name: lastName
      });
      user.populateWhoColumns(crypto.randomUUID());
 
      const savedUser = await this.userRepository.save(user);
 
      return { user: savedUser, tempPassword };
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Failed to create user in Keycloak');
    }
  }


  async resetPassword(email: string): Promise<string> {
    const newPassword = this.generateRandomPassword(12);
  
    const token = await this.getKeycloakToken();
  
    try {
      const keycloakUsersResponse = await axios.get(
        `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: { email },
        },
      );
  
      const keycloakUser = keycloakUsersResponse.data[0]; 
      if (!keycloakUser) {
        throw new NotFoundException('User not found in Keycloak');
      }
  
      await axios.put(
        `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}/reset-password`,
        {
          type: 'password',
          value: newPassword,
          temporary: true, 
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
  
      return newPassword;
    } catch (error) {
      throw new InternalServerErrorException('Failed to reset password in Keycloak');
    }
  }
 
  async setUserStatus(email: string, enable: boolean): Promise<User> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
 
    user.user_status = enable ? 'active' : 'inactive';
    await this.userRepository.save(user);
 
    try {
      const token = await this.getKeycloakToken();
 
      const keycloakUsersResponse = await axios.get(
        `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: { email: email },
        },
      );
 
      const keycloakUser = keycloakUsersResponse.data[0]; 
      if (!keycloakUser) {
        throw new NotFoundException('User not found in Keycloak');
      }
 
      await axios.put(
        `${process.env.KEYCLOAK_BASE_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUser.id}`,
        {
          enabled: enable,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      throw new InternalServerErrorException('Failed to update user status in Keycloak');
    }
 
    return user;
  }
}