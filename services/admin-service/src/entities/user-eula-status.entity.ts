import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Base } from './base.entity';

@Entity('user_eula_status')
export class UserEulaStatus extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'user_id' })
  userId: string;

  @Column({ type: 'boolean', name: 'eula_accepted', default: false })
  eulaAccepted: boolean;

  @Column({ type: 'varchar', length: 100 })
  version: string;
}
