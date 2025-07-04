import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { Base } from './base.entity';

@Entity('user')
export class User extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
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