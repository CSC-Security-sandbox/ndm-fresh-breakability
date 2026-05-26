import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Base } from "./base.entity";
import { WorkerEntity } from "./worker.entity";
import { ApiProperty } from "@nestjs/swagger";

@Entity({ name: "worker_stats" })
export class WorkerStatsEntity extends Base {
  @PrimaryColumn({ type: "uuid", name: "id" })
  id: string;

  @ApiProperty({ description: "Health Status of worker" })
  @Column({
    name: "health_status",
    type: "varchar",
    length: 50,
    nullable: false,
  })
  healthStatus: string;

  @ApiProperty({ description: "System Stats in JSON format" })
  @Column({ name: "system_stats", type: "jsonb", nullable: true })
  systemStats: Record<string, any>;

  @Column({ type: "uuid", nullable: false, name: "worker_id" })
  workerId: string;

  @OneToOne(() => WorkerEntity, (worker) => worker.stats)
  @JoinColumn({ name: "worker_id" }) // Foreign key column in the worker_stats table
  worker: WorkerEntity;
}
