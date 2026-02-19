import { Controller, Get, Param, Res, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CertificateService } from './certificate.service';
import { ModuleCertificateService } from './module-certificate.service';

@Controller('api/certificates')
@ApiTags('Certificates')
export class CertificateController {
  constructor(
    private readonly certificateService: CertificateService,
    private readonly moduleCertificateService: ModuleCertificateService,
  ) {}

  // ===================== MODULE CERTIFICATE ENDPOINTS =====================

  @Get('module/student/my-certificates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get all module certificates for authenticated student' })
  async getMyModuleCertificates(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.moduleCertificateService.getStudentCertificates(userId);
  }

  @Get('module/public/:publicId')
  @ApiOperation({ summary: 'Get module certificate by public ID (no auth)' })
  async getModuleCertificatePublic(@Param('publicId') publicId: string) {
    return this.moduleCertificateService.getCertificateByPublicId(publicId);
  }

  @Get('module/public/:publicId/view')
  @ApiOperation({ summary: 'View module certificate PDF (no auth)' })
  async viewModuleCertificatePublic(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ) {
    try {
      const pdfBuffer = await this.moduleCertificateService.generateCertificatePDFByPublicId(publicId);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename=module-certificate-${publicId}.pdf`,
      });
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({
        message: error.message || 'Certificate not found',
      });
    }
  }

  @Get('module/public/:publicId/download')
  @ApiOperation({ summary: 'Download module certificate PDF (no auth)' })
  async downloadModuleCertificatePublic(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ) {
    try {
      const pdfBuffer = await this.moduleCertificateService.generateCertificatePDFByPublicId(publicId);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=module-certificate-${publicId}.pdf`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({
        message: error.message || 'Certificate not found',
      });
    }
  }

  @Get('module/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get module certificate by ID' })
  async getModuleCertificate(@Param('id') id: string) {
    return this.moduleCertificateService.getCertificateById(id);
  }

  @Get('module/:id/download')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Download module certificate PDF' })
  async downloadModuleCertificate(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    try {
      const userId = req.user?.userId || req.user?.id;
      const pdfBuffer = await this.moduleCertificateService.generateCertificatePDFWithAuth(id, userId);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=module-certificate-${id}.pdf`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(pdfBuffer);
    } catch (error) {
      res.status(error.status || 404).json({
        message: error.message || 'Certificate not found',
      });
    }
  }

  // ===================== LEGACY COURSE CERTIFICATE ENDPOINTS =====================

  @Get('public/:publicId')
  @ApiOperation({ summary: 'Get certificate by public ID (no auth required)' })
  @ApiParam({ name: 'publicId', description: 'Certificate UUID' })
  async getPublicCertificate(@Param('publicId') publicId: string) {
    return this.certificateService.getCertificateByPublicId(publicId);
  }

  @Get('public/:publicId/view')
  @ApiOperation({ summary: 'View certificate PDF (no auth required)' })
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
      });
    }
  }

  @Get('public/:publicId/download')
  @ApiOperation({ summary: 'Download certificate PDF (no auth required)' })
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
      });
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Get certificate by ID (authenticated)' })
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
      });
    }
  }
}
