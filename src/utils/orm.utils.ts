import { JoinTableOptions } from 'typeorm';

export function createJoinTableConfig(
  tableName: string,
  joinColumnName: string,
  joinColumnReferencedName: string,
  inverseJoinColumnName: string,
  inverseJoinColumnReferencedName: string
): JoinTableOptions {
  return {
    name: tableName, 
    joinColumn: {
      name: joinColumnName, 
      referencedColumnName: joinColumnReferencedName,
    },
    inverseJoinColumn: {
      name: inverseJoinColumnName,
      referencedColumnName: inverseJoinColumnReferencedName, 
    },
  };
}