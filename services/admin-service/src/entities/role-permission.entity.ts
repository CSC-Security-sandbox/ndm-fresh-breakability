import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from './base.entity';
import { Role } from './role.entity';
import { Permission } from './permission.entity';

@Entity('role_permission')
export class RolePermission extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Role, (role) => role.role_permissions, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @ManyToOne(() => Permission, (permission) => permission.role_permissions, {
    nullable: false,
  })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;
}
