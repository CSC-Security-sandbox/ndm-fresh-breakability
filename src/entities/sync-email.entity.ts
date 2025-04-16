import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

@Entity('sync_email')
export class SyncEmail extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column({ type: 'varchar', length: 255, name: 'sender' })
  sender: string;

  @Column({ type: 'text', name: 'receiver' })
  reciever: string;

  @Column({ type: 'varchar', nullable: true, name: 'mail_content' })
  mailContent: string;

  @Column({ type: 'boolean', name: 'sync' })
  sync: boolean;
}
