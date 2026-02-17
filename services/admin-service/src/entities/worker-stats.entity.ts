import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Lightweight projection of worker_stats table for admin-service.
 * Only maps columns needed for health check (updated_at).
 */
@Entity({ name: 'worker_stats' })
export class WorkerStatsEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id: string;

  @Column({ type: 'uuid', name: 'worker_id' })
  workerId: string;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt: Date;
}
