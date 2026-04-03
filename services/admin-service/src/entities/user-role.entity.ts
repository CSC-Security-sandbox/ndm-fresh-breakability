import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
} from 'typeorm';
import { Base } from './base.entity';
import { User } from './user.entity';
import { Role } from './role.entity';
import { Project } from './project.entity';
import { Account } from './account.entity';

@Entity('user_role')
export class UserRole extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.user_roles, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role, (role) => role.user_roles, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @ManyToOne(() => Project, (project) => project.user_roles, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @ManyToOne(() => Account, (account) => account.user_roles, {
    nullable: false,
  })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'project_id', nullable: true })
  projectId: string | null;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ name: 'account_id' })
  accountId: string;
}
