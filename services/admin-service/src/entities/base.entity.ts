import { Entity, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Base {
  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  public populateWhoColumns(userId: string): void {
    if (!this.created_by) {
      this.created_by = userId;
    }
    this.updated_by = userId;
  }
}
