import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Base } from './base.entity';
import { RolePermission } from './role-permission.entity';

@Entity('permission')
export class Permission extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  permission_name: string;

  @Column({ length: 80 })
  permission_status: string;

  @OneToMany(
    () => RolePermission,
    (role_permission) => role_permission.permission,
  )
  role_permissions: RolePermission[];
}
