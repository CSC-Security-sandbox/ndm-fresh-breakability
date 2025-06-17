// controller for handling path uploads
import * as fs from 'fs';
import { join } from 'path';
import { Response } from "express";
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { Controller, Post, Body, Param, Request, Get, Res, Patch } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateValidationResultDto, ImportVolumePathsDto as UploadVolumePathsDto } from './dto/path-upload.dto';
import { UserDetails } from '../configurations/configuration.types';
import { PathUploadService } from './path-upload.service';


@ApiTags('Path Uploads')
@Controller('path-upload')
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
    async updateUploadValidationResult(
        @Param('uploadId') uploadId: string,
        @Body() body: UpdateValidationResultDto,
    ) {
        return await this.pathUploadService.processUploadUpdate(body.validationResult, uploadId);
    }

    @ApiOperation({ summary: 'Download CSV File' })
    @ApiOkResponse({ description: 'CSV File Downloaded Successfully' })
    @ApiNotFoundResponse({ description: 'File Not Found' })
    @Get('download/template')
    async downloadCsvFile(@Res() res: Response) {
        const headers = ['path'];
        const records = [{ path: 'example/path/to/volume' }];
        const csvContent = [headers.join(','), ...records.map(row => Object.values(row).join(','))].join('\n');
        const fileName = 'volume_paths_template.csv';
        
        // create the uploads directory if it doesn't exist
        await this.pathUploadService.createUploadDirectory();

        const filePath = join(process.cwd(), './uploads', fileName);
        fs.writeFileSync(filePath, csvContent);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.sendFile(filePath);
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res)
    }
}