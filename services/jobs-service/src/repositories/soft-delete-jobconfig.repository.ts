import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindManyOptions,
  FindOneOptions,
} from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';

/**
 * Custom repository for JobConfigEntity that automatically filters out
 * soft-deleted records (isDeleted = true) from all standard find operations.
 *
 * Usage:
 *  - find / findOne / findAndCount / count → auto-exclude soft-deleted
 *  - All other Repository methods (save, create, update, remove, etc.)
 *    are delegated directly to the underlying TypeORM repository.
 */
@Injectable()
export class SoftDeleteJobConfigRepository {
  constructor(
    @InjectRepository(JobConfigEntity)
    private readonly repo: Repository<JobConfigEntity>,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Internal helper – merges isDeleted: false into the where clause   */
  /* ------------------------------------------------------------------ */

  private injectSoftDeleteFilter<T extends FindManyOptions<JobConfigEntity>>(
    options?: T,
  ): T {
    const opts = (options ?? {}) as T;

    if (Array.isArray(opts.where)) {
      // where is an array of conditions (OR) – add filter to each
      opts.where = opts.where.map((w) => ({
        ...w,
        isDeleted: false,
      })) as any;
    } else {
      opts.where = {
        ...(opts.where as any),
        isDeleted: false,
      } as any;
    }

    return opts;
  }

  /* ------------------------------------------------------------------ */
  /*  Overridden find methods – auto-exclude soft-deleted records       */
  /* ------------------------------------------------------------------ */

  async find(options?: FindManyOptions<JobConfigEntity>): Promise<JobConfigEntity[]> {
    return this.repo.find(this.injectSoftDeleteFilter(options));
  }

  async findOne(options: FindOneOptions<JobConfigEntity>): Promise<JobConfigEntity | null> {
    return this.repo.findOne(
      this.injectSoftDeleteFilter(options as FindManyOptions<JobConfigEntity>) as FindOneOptions<JobConfigEntity>,
    );
  }

  async findAndCount(
    options?: FindManyOptions<JobConfigEntity>,
  ): Promise<[JobConfigEntity[], number]> {
    return this.repo.findAndCount(this.injectSoftDeleteFilter(options));
  }

  async count(options?: FindManyOptions<JobConfigEntity>): Promise<number> {
    return this.repo.count(this.injectSoftDeleteFilter(options));
  }

  /* ------------------------------------------------------------------ */
  /*  Delegate all other Repository methods directly                    */
  /* ------------------------------------------------------------------ */

  get manager() {
    return this.repo.manager;
  }

  get metadata() {
    return this.repo.metadata;
  }

  get target() {
    return this.repo.target;
  }

  create(entityLike: any): any {
    return this.repo.create(entityLike);
  }

  async save(entityOrEntities: any): Promise<any> {
    return this.repo.save(entityOrEntities);
  }

  async update(
    criteria: any,
    partialEntity: any,
  ): Promise<any> {
    return this.repo.update(criteria, partialEntity);
  }

  async remove(entityOrEntities: any): Promise<any> {
    return this.repo.remove(entityOrEntities);
  }

  async delete(criteria: any): Promise<any> {
    return this.repo.delete(criteria);
  }

  /**
   * WARNING: createQueryBuilder does NOT auto-inject the isDeleted filter.
   * You MUST manually add `.andWhere("alias.isDeleted = :isDeleted", { isDeleted: false })`
   * to any query built with this method to exclude soft-deleted records.
   */
  createQueryBuilder(alias?: string) {
    return this.repo.createQueryBuilder(alias);
  }

  async query(query: string, parameters?: any[]): Promise<any> {
    return this.repo.query(query, parameters);
  }
}
