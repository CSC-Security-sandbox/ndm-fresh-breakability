import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'error_remedies' })
export class ErrorRemedyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, name: 'error_code' })
  errorCode: string;

  @Column({ type: 'text', name: 'description' })
  description: string;

  @Column({ type: 'text', name: 'resolution_steps' })
  resolutionSteps: string;

  @Column({ type: 'text', nullable: true, name: 'reference_commands' })
  referenceCommands: string;
}
