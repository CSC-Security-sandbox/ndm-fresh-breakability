import { ApiProperty } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';
import { Operations, ResponseStatus, TaskType } from 'src/constants/status';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Base } from './base.entity';
import { WorkerEntity } from './worker.entity';

@Entity({name:'request_track', schema:'migrate'})
export class RequestTrackEntity extends Base {
  @ApiProperty({ description: 'Unique identifier for the request' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Type of the request' })
  @Column({ type: 'text', name:'task_type',  nullable: false})
  taskType: TaskType;

  @ApiProperty({ description: 'Data' })
  @Column({ type: 'text', nullable: true,  name:'response' })
  response: string;

  @ApiProperty({ description: 'Status of the request', name:'status'  })
  @Column({ type: 'text', name:'status',  nullable: false})
  status: ResponseStatus;

  @ApiProperty({ description: 'Operation of the request',  name:'operation'  })
  @Column({ type: 'text', enum: Protocol, nullable: false })
  operation: Operations;

  @ApiProperty({ description: 'Worker ID' })
  @Column({ type: 'text', nullable: false, name: 'worker_id'  })
  workerId: string;

  @ApiProperty({ description: 'transactionId' })
  @Column({ type: 'uuid', nullable: false,  name: 'transaction_id'  })
  transactionId: string;

  @ApiProperty({ description: 'configId' })
  @Column({ type: 'uuid', nullable: true,  name: 'config_id'  })
  configId: string;

  @ManyToOne(() => WorkerEntity)
  @JoinColumn({ name: 'worker_id' }) 
  WorkerEntity: WorkerEntity;

}
