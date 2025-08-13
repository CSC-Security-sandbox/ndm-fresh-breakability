import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ name: 'network_latency' })
export class NetworkLatencyEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'worker_id', type: 'uuid' })
    workerId: string;

    @Column({ name: 'control_plane_ip' })
    controlPlaneIP: string;

    @Column({ name: 'min', type: 'double precision' })
    min: number;

    @Column({ name: 'max', type: 'double precision' })
    max: number;

    @Column({ name: 'avg', type: 'double precision' })
    avg: number;

    @Column({ name: 'measured_at', type: 'timestamp with time zone' })
    measuredAt: Date;

    @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt: Date;
}
