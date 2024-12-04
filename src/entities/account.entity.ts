import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';

import { Base } from './base.entity';
import { Project } from './project.entity';
import { UserRole } from './user-role.entity';
@Entity('account')
export class Account extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 180 })
  account_name: string;

  @OneToMany(() => UserRole, (user_role) => user_role.account)
  user_roles: UserRole[];

  @OneToMany(() => Project, (project) => project.account)
  projects: Project[];
}
