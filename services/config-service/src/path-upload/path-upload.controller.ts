// controller for handling path uploads
import * as fs from 'fs';
import { join, basename } from 'path';

import { Response } from "express";
import { Auth, AuthWorker, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { Controller, Post, Body, Param, Request, Get, Res, Patch, NotFoundException } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateValidationResultDto, ImportVolumePathsDto as UploadVolumePathsDto } from './dto/path-upload.dto';
import { UserDetails } from '../configurations/configuration.types';
import { PathUploadService } from './path-upload.service';


@ApiTags('Paths Upload')
@Controller('paths-upload')
export class PathUploadController {
    
    constructor(private pathUploadService: PathUploadService) {}
    
    @ApiOperation({ summary: 'Upload Volume Paths' })
    @ApiBody({
      description: 'Upload CSV and metadata',
      type: UploadVolumePathsDto,
    })
    @ApiOkResponse({ description: 'Volume Paths Uploaded Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBadRequestResponse({ description: 'Invalid Volume Paths' })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Post(':fileServerId')
    async importVolumePaths(
        @Body() uploadVolumePathsDto: UploadVolumePathsDto,
        @Param('fileServerId') fileServerId: string,
        @Request() userDetails: UserDetails
    ) {
        return await this.pathUploadService.processFileUpload(uploadVolumePathsDto, fileServerId, userDetails);
    }

    @ApiOperation({ summary: 'Confirm Path Upload' })
    @ApiOkResponse({ description: 'Path Upload Confirmed Successfully' })
    @ApiNotFoundResponse({ description: 'Upload Not Found' })
    @ApiBadRequestResponse({ description: 'Invalid Upload Confirmation' })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Post('confirm/:uploadId')
    async confirmPathUpload(@Param('uploadId') uploadId: string) {
        return await this.pathUploadService.processUploadPathValidation(uploadId);
    }

    @ApiOperation({ summary: 'Update Upload Validation Result' })
    @ApiOkResponse({ description: 'Upload Validation Result Updated Successfully' })
    @ApiNotFoundResponse({ description: 'Upload Not Found' })
    @ApiBadRequestResponse({ description: 'Invalid Upload ID or Validation Result' })
    @Patch(':uploadId')
    @ApiBearerAuth()
    @AuthWorker()
    async updateUploadValidationResult(
        @Param('uploadId') uploadId: string,
        @Body() body: UpdateValidationResultDto,
    ) {
        return await this.pathUploadService.processUploadUpdate(body.validationResult, uploadId);
    }

    @ApiOperation({ summary: 'Download CSV File' })
    @ApiOkResponse({ description: 'CSV File Downloaded Successfully' })
    @ApiNotFoundResponse({ description: 'File Not Found' })
    @Get('download/:type/:fileServerId')
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    async downloadCsvFile(
        @Param('type') type: 'template' | 'uploaded-paths',
        @Res() res: Response,
        @Param('fileServerId') fileServerId: string,
    ) {
        const allowedTypes = ['template', 'uploaded-paths'];
        if (!allowedTypes.includes(type as string)) throw new NotFoundException('Invalid type parameter');

        const headers = type === 'template' ? ['path'] : ['path', 'action', 'status', 'message'];
        let records = [{ path: 'example/path/to/volume' }];
        const sanitizedTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = type === 'template' ? 'volume_paths_template.csv' : `uploaded_paths_${sanitizedTimestamp}.csv`;
        if(type === 'uploaded-paths') records = await this.pathUploadService.getUploadedPaths(fileServerId);
        const csvContent = [headers.join(','), ...records.map(row => Object.values(row).join(','))].join('\n');

        // create the uploads directory if it doesn't exist
        await this.pathUploadService.createUploadDirectory();
        const uploadsDir = join('/uploads');
        const filePath = join(uploadsDir, basename(fileName));
        fs.writeFileSync(filePath, csvContent, { encoding: 'utf8' });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        // sendFile handles reading and streaming the file — do not also pipe a readStream as that causes a double-response error
        res.sendFile(filePath);
    }
}