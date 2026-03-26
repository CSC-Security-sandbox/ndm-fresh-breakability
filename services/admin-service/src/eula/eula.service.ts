import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { UserEulaStatus } from '../entities/user-eula-status.entity';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';
import { UpgradeStatus } from '../upgrade/enums/upgrade.enums';

@Injectable()
export class EulaService {
  private readonly logger: LoggerService;
  private readonly eulaTemplatePath: string;
  private readonly internalApiKey: string | null;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @InjectRepository(UserEulaStatus)
    private readonly userEulaStatusRepo: Repository<UserEulaStatus>,
    @InjectRepository(UpgradeBundle)
    private readonly upgradeBundleRepo: Repository<UpgradeBundle>,
  ) {
    this.logger = loggerFactory.create(EulaService.name);
    this.eulaTemplatePath =
      process.env.EULA_TEMPLATE_PATH ||
      path.resolve(
        process.cwd(),
        '../keycloak-customizations/themes/datamigrate/login/eula.ftl',
      );
    this.internalApiKey = process.env.EULA_INTERNAL_API_KEY || null;
  }

  async getStatus(userId: string) {
    const existing = await this.userEulaStatusRepo.findOne({ where: { userId } });

    if (!existing) {
      return {
        eulaAccepted: true,
        version: await this.getCurrentCpVersion(),
        mustAccept: false,
        content: await this.getSharedEulaContent(),
      };
    }

    return {
      eulaAccepted: existing.eulaAccepted,
      version: existing.version,
      mustAccept: !existing.eulaAccepted,
      content: await this.getSharedEulaContent(),
    };
  }

  async accept(userId: string) {
    const requiredVersion = await this.getCurrentCpVersion();
    let existing = await this.userEulaStatusRepo.findOne({ where: { userId } });
    if (!existing) {
      existing = this.userEulaStatusRepo.create({
        userId,
        eulaAccepted: true,
        version: requiredVersion,
      });
    } else {
      existing.eulaAccepted = true;
      existing.version = requiredVersion;
    }
    existing.populateWhoColumns(userId);
    await this.userEulaStatusRepo.save(existing);
    return { accepted: true, version: requiredVersion };
  }

  async markAllUsersPending(newVersion: string): Promise<void> {
    await this.userEulaStatusRepo
      .createQueryBuilder()
      .update(UserEulaStatus)
      .set({
        eulaAccepted: false,
        version: newVersion,
      })
      .execute();
    this.logger.log(`Marked all user_eula_status records pending for ${newVersion}`);
  }

  async markAllUsersPendingViaApi(newVersion: string, providedKey: string | undefined): Promise<void> {
    this.assertInternalApiKey(providedKey);
    await this.markAllUsersPending(newVersion);
  }

  async acceptForUserViaApi(userId: string, providedKey: string | undefined): Promise<{ accepted: boolean; version: string }> {
    this.assertInternalApiKey(providedKey);
    return this.accept(userId);
  }

  private async getSharedEulaContent(): Promise<string> {
    const fallbackPath = path.resolve(
      process.cwd(),
      'services/keycloak-customizations/themes/datamigrate/login/eula.ftl',
    );
    const candidates = [this.eulaTemplatePath, fallbackPath];

    for (const candidate of candidates) {
      try {
        return await fsPromises.readFile(candidate, 'utf-8');
      } catch {
        // Try next path.
      }
    }

    this.logger.warn('Unable to read shared EULA template file from configured paths');
    return '<p>EULA content is currently unavailable.</p>';
  }

  private async getCurrentCpVersion(): Promise<string> {
    const latestSuccess = await this.upgradeBundleRepo.findOne({
      where: { upgradeStatus: UpgradeStatus.SUCCESS },
      order: { updated_at: 'DESC' },
    });
    return latestSuccess?.version || 'unknown';
  }

  private assertInternalApiKey(providedKey: string | undefined): void {
    if (!this.internalApiKey || !providedKey || providedKey !== this.internalApiKey) {
      throw new ForbiddenException('Invalid internal API key');
    }
  }

}
