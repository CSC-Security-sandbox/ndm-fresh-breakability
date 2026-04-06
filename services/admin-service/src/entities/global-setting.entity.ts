import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Base } from './base.entity';

@Entity('global_settings')
export class GlobalSettings extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'setting_key' })
  settingKey: string;

  @Column({ type: 'text', name: 'setting_value' })
  settingValue: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'text', nullable: true, name: 'setting_type' })
  settingType?: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'serial_id' })
  serialId?: string;
}
