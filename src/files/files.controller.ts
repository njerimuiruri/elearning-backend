import { Controller, Get, Param, Res, BadRequestException, NotFoundException, Query, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('api/files')
@ApiTags('Files')
export class FilesController {
  @Get('download/*')
  @ApiOperation({ summary: 'Download file by filename' })
  @ApiResponse({ status: 200, description: 'File downloaded successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async downloadFile(
    @Req() req: Request,
    @Query('inline') inline: string,
    @Res() response: Response,
  ) {
    try {
      // Get the full path after /download/
      // For URL: /api/files/download/uploads/cvs/file.pdf
      // req.params[0] or req.path will contain the wildcard portion
      const fullPath = req.path.replace(/^\/api\/files\/download\//, '');
      
      let requestedPath = fullPath.trim();
      if (!requestedPath) {
        throw new BadRequestException('Filename is required');
      }

      console.log('Original requestedPath:', requestedPath);

      // Replace backslashes with forward slashes
      requestedPath = requestedPath.replace(/\\+/g, '/');
      
      // Strip any leading uploads/ prefix (since we'll add it back)
      requestedPath = requestedPath.replace(/^uploads\//i, '');

      console.log('Normalized requestedPath:', requestedPath);

      // Prevent directory traversal attacks
      if (requestedPath.includes('..')) {
        throw new BadRequestException('Invalid filename');
      }

      const filePath = path.join(process.cwd(), 'uploads', requestedPath);
      console.log('Constructed filePath:', filePath);
      
      // Verify the file exists and is within the uploads directory
      const uploadsDir = path.resolve(path.join(process.cwd(), 'uploads'));
      const realPath = path.resolve(filePath);
      
      console.log('uploadsDir:', uploadsDir);
      console.log('realPath:', realPath);
      console.log('File exists:', fs.existsSync(filePath));
      
      if (!realPath.startsWith(uploadsDir)) {
        throw new BadRequestException('Invalid file path');
      }

      if (!fs.existsSync(filePath)) {
        throw new NotFoundException('File not found');
      }

      const fileBuffer = fs.readFileSync(filePath);
      
      // Set appropriate content type and disposition based on file extension
      const baseName = path.basename(requestedPath);
      const ext = path.extname(baseName).toLowerCase();
      let contentType = 'application/octet-stream';
      let disposition = 'attachment'; // Default to download
      
      // Determine the download filename
      let downloadFilename = baseName;
      
      // For CV files, format the filename nicely for download
      if (requestedPath.includes('cvs/cv-') || baseName.startsWith('cv-')) {
        // Extract the name parts from the filename (cv-firstname-lastname-timestamp.pdf)
        const cvMatch = baseName.match(/^cv-([^-]+)-([^-]+)-\d+-\d+\.pdf$/);
        if (cvMatch) {
          const firstName = cvMatch[1].charAt(0).toUpperCase() + cvMatch[1].slice(1);
          const lastName = cvMatch[2].charAt(0).toUpperCase() + cvMatch[2].slice(1);
          downloadFilename = `cv-${firstName}-${lastName}.pdf`;
        }
      }
      
      // For images, allow inline display
      if (['.jpg', '.jpeg'].includes(ext)) {
        contentType = 'image/jpeg';
        disposition = inline === 'true' ? 'inline' : 'attachment';
      } else if (ext === '.png') {
        contentType = 'image/png';
        disposition = inline === 'true' ? 'inline' : 'attachment';
      } else if (ext === '.gif') {
        contentType = 'image/gif';
        disposition = inline === 'true' ? 'inline' : 'attachment';
      } else if (ext === '.pdf') {
        contentType = 'application/pdf';
        disposition = inline === 'true' ? 'inline' : 'attachment';
      } else if (ext === '.doc') {
        contentType = 'application/msword';
      } else if (ext === '.docx') {
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (ext === '.txt') {
        contentType = 'text/plain';
      }

      // Set headers for proper file handling
      response.setHeader('Content-Type', contentType);
      response.setHeader('Content-Disposition', `${disposition}; filename="${downloadFilename}"`);
      response.setHeader('Content-Length', fileBuffer.length);
      response.setHeader('Cache-Control', 'public, max-age=3600');
      
      response.send(fileBuffer);
    } catch (error) {
      if (error instanceof NotFoundException) {
        response.status(404).json({ message: 'File not found' });
      } else if (error instanceof BadRequestException) {
        response.status(400).json({ message: error.message });
      } else {
        console.error('Error downloading file:', error);
        response.status(500).json({ message: 'Error downloading file' });
      }
    }
  }
}
