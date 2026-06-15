import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Base } from './base.entity';
import { UserRole } from './user-role.entity';

@Entity('user')
export class User extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToMany(() => UserRole, (user_role) => user_role.user, {
    cascade: ['remove'],
  })
  @JoinColumn({ name: 'user_id' })
  user_roles: UserRole[];

  @Column({ length: 100, unique: true })
  email: string;

  @Column({ length: 100 })
  first_name: string;

  @Column({ length: 100 })
  last_name: string;

  @Column({ length: 80 })
  user_status: string;

  get name(): string {
    return `${this.first_name || ''} ${this.last_name || ''}`.trim();
  }
}
