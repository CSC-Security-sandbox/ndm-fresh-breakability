import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    Body,
    Req,
    Res,
    HttpStatus,
    ParseUUIDPipe,
  } from '@nestjs/common';
  import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiConsumes,
    ApiBody,
  } from '@nestjs/swagger';
  import { Request, Response } from 'express';
  import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
  import { UpgradeService } from './upgrade.service';
  import { InitUploadDto, InitUploadResponseDto } from './dto/init-upload.dto';
  import { UploadChunkResponseDto } from './dto/upload-chunk.dto';
  
  @ApiTags('upgrade')                        // Swagger: Groups all endpoints under "upgrade"
  @Controller('/api/v1/upgrade')             // Base path for all routes
  export class UpgradeController {
    constructor(private readonly upgradeService: UpgradeService) {}
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 1: Initialize Upload Session
    // ═══════════════════════════════════════════════════════════════
    @Auth()                                  // Requires valid JWT token
    @ApiBearerAuth()                         // Swagger: Shows lock icon
    @Post('init')
    @ApiOperation({ summary: 'Initialize a new upgrade bundle upload session' })
    @ApiResponse({ status: 201, type: InitUploadResponseDto })
    async initUpload(@Body() dto: InitUploadDto): Promise<InitUploadResponseDto> {
      return this.upgradeService.initUpload(dto);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 2: Upload a Single Chunk
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('chunk/:uploadId')
    @ApiOperation({ summary: 'Upload a single chunk of the upgrade bundle' })
    @ApiConsumes('application/octet-stream')  // Accepts raw binary data
    @ApiResponse({ status: 200, type: UploadChunkResponseDto })
    async uploadChunk(
      @Param('uploadId', ParseUUIDPipe) uploadId: string,  // Validates UUID format
      @Req() req: Request,                                   // Raw request for streaming
      @Res() res: Response,                                  // Raw response for manual control
    ): Promise<void> {
      // Get chunk index from header (can't use body since body IS the chunk data)
      const chunkIndex = parseInt(req.headers['x-chunk-index'] as string, 10);
      
      const result = await this.upgradeService.uploadChunk(uploadId, chunkIndex, req);
      
      res.status(HttpStatus.OK).json(result);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 3: Get Upload Status/Progress
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Get('status/:uploadId')
    @ApiOperation({ summary: 'Get the current status of an upload' })
    async getStatus(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.getStatus(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 4: Finalize Upload (Assemble Chunks)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('finalize/:uploadId')
    @ApiOperation({ summary: 'Finalize upload: assemble chunks and verify checksum' })
    async finalizeUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.finalizeUpload(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 5: Cancel Upload (Cleanup)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Delete('cancel/:uploadId')
    @ApiOperation({ summary: 'Cancel upload and cleanup temporary files' })
    async cancelUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.cancelUpload(uploadId);
    }

    @Auth()
    @ApiBearerAuth()
    @Post('trigger')
    @ApiOperation({ summary: 'Trigger the upgrade process' })
    async triggerUpgrade(
    @Body() body: { filePath: string; fileName?: string },
    ) {
    return this.upgradeService.triggerUpgrade(body.filePath, body.fileName);
    }
  }