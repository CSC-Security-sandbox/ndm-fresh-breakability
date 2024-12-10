import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Base } from './base.entity';
import { RolePermission } from './role-permission.entity';
import { UserRole } from './user-role.entity';

@Entity('role')
export class Role extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 180 })
  role_name: string;

  @Column({ length: 80 })
  role_status: string;

  @OneToMany(() => UserRole, (user_role) => user_role.role)
  @JoinColumn({ name: 'role_id' })
  user_roles: UserRole[];

  @OneToMany(() => RolePermission, (role_permission) => role_permission.role)
  role_permissions: RolePermission[];
}
