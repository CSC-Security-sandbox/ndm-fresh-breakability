import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Account } from './account.entity';
import { Base } from './base.entity';
import { UserRole } from './user-role.entity';

@Entity('project')
@Unique('UQ_project_account_name', ['account', 'project_name'])
export class Project extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, (account) => account.projects)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @OneToMany(() => UserRole, (user_role) => user_role.project)
  user_roles: UserRole[];

  @Column({ length: 180, nullable: false })
  project_name: string;

  @Column({ type: 'date', nullable: true })
  start_date: Date;

  @Column({ type: 'text', nullable: true })
  project_description: string;
}
