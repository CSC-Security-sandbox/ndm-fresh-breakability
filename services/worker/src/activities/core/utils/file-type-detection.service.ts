import { Injectable, Inject } from '@nestjs/common';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { getFileType } from 'src/activities/utils/utils';
import { FileType } from 'src/activities/types/tasks';
import { WinOperationService } from '../migrate/command-execution/win-opeartions/win-operation.service';

@Injectable()
export class FileTypeDetectionService {

    private readonly logger: LoggerService;
    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly winOperationService: WinOperationService
    ) {
        this.logger = loggerFactory.create(FileTypeDetectionService.name);
    }

    // Detect File type using special Windows link types
    async detectFileType(sourceContentPath: string, sourceStat: fs.Stats): Promise<FileType> {
        let symlinkType: FileType | undefined;
        if (process.platform === 'win32') {
            // Check if symbolic link or directory (to detect junctions and volume mount points)
            if (sourceStat.isSymbolicLink() || sourceStat.isDirectory()) {
                try {
                    // Detect detailed link type (junction, volume mount point, symbolic link)
                    const linkInfo = await this.winOperationService.detectSymbolicLinkType(sourceContentPath);
                    if (linkInfo === FileType.VOLUME_MOUNT_POINT) {
                        symlinkType = FileType.VOLUME_MOUNT_POINT;
                        this.logger.debug(`Detected volume mount point for ${sourceContentPath}`);
                    } else if (linkInfo === FileType.JUNCTION) {
                        symlinkType = FileType.JUNCTION;
                        this.logger.debug(`Detected junction for ${sourceContentPath}`);
                    } else if (linkInfo === FileType.SYMBOLIC_LINK) {
                        symlinkType = FileType.SYMBOLIC_LINK;
                        this.logger.debug(`Detected symbolic link for ${sourceContentPath}`);
                    } else {
                        symlinkType = FileType.UNKNOWN;
                        this.logger.debug(`Detected unknown link type for ${sourceContentPath}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to detect link type for ${sourceContentPath}: ${error.message}`);
                    throw error;
                }
            } else if (!sourceStat.isDirectory() && path.extname(sourceContentPath).toLowerCase() === '.lnk') {
                symlinkType = FileType.SHORTCUT;
                this.logger.debug(`Detected shortcut for ${sourceContentPath}`);
            }
        }

        const fileType = (symlinkType && symlinkType !== FileType.UNKNOWN)
            ? symlinkType
            : getFileType(sourceStat, sourceStat.isDirectory());
        
        return fileType;
    }
}