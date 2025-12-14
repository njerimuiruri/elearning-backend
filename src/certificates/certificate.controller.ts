import { Controller, Get, Param, Res, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CertificateService } from './certificate.service';

@Controller('api/certificates')
@ApiTags('Certificates')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get('public/:publicId')
  @ApiOperation({ summary: 'Get certificate by public ID (no auth required)' })
  @ApiParam({ name: 'publicId', description: 'Certificate UUID' })
  @ApiResponse({ status: 200, description: 'Certificate data retrieved' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async getPublicCertificate(@Param('publicId') publicId: string) {
    return this.certificateService.getCertificateByPublicId(publicId);
  }

  @Get('public/:publicId/view')
  @ApiOperation({ summary: 'View certificate PDF (no auth required)' })
  @ApiParam({ name: 'publicId', description: 'Certificate UUID' })
  @ApiResponse({ status: 200, description: 'PDF stream' })
  async viewPublicCertificate(@Param('publicId') publicId: string, @Res() res: Response) {
    try {
      const certificate = await this.certificateService.getCertificateByPublicId(publicId);
      const pdfBuffer = await this.certificateService.createPDFBuffer(certificate);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename=certificate-${certificate.certificateNumber}.pdf`,
      });
      
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({ 
        message: error.message || 'Certificate not found',
        error: error.name || 'Not Found'
      });
    }
  }

  @Get('public/:publicId/download')
  @ApiOperation({ summary: 'Download certificate PDF (no auth required)' })
  @ApiParam({ name: 'publicId', description: 'Certificate UUID' })
  @ApiResponse({ status: 200, description: 'PDF file' })
  async downloadPublicCertificate(@Param('publicId') publicId: string, @Res() res: Response) {
    try {
      const certificate = await this.certificateService.getCertificateByPublicId(publicId);
      const pdfBuffer = await this.certificateService.createPDFBuffer(certificate);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=certificate-${certificate.certificateNumber}.pdf`,
        'Content-Length': pdfBuffer.length,
      });
      
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({ 
        message: error.message || 'Certificate not found',
        error: error.name || 'Not Found'
      });
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get certificate by ID (authenticated)' })
  @ApiParam({ name: 'id', description: 'Certificate/Enrollment ID' })
  @ApiResponse({ status: 200, description: 'Certificate data retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCertificate(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.certificateService.getCertificateByIdWithAuth(id, userId);
  }

  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  async downloadCertificate(@Param('id') id: string, @Res() res: Response, @Req() req: any) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const pdfBuffer = await this.certificateService.generateCertificatePDFWithAuth(id, userId);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=certificate-${id}.pdf`,
        'Content-Length': pdfBuffer.length,
      });
      
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({ 
        message: error.message || 'Certificate not found',
        error: error.name || 'Not Found'
      });
    }
  }

  @Get(':id/view')
  @UseGuards(JwtAuthGuard)
  async viewCertificate(@Param('id') id: string, @Res() res: Response, @Req() req: any) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const pdfBuffer = await this.certificateService.generateCertificatePDFWithAuth(id, userId);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename=certificate-${id}.pdf`,
      });
      
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({ 
        message: error.message || 'Certificate not found',
        error: error.name || 'Not Found'
      });
    }
  }
}
