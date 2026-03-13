import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';

export enum IncidentStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity('sync_email')
export class SyncEmailEntity extends Base {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb', name: 'mail_content', nullable: false })
  mailContent: object;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    name: 'incident_status',
    nullable: false,
  })
  incidentStatus: IncidentStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ name: 'alertsource', type: 'text', nullable: true })
  alertSource: string;

  @Column({ name: 'alertname', type: 'text', nullable: true })
  alertName: string;
}
