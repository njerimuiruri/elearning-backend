import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { CreatePaymentIntentDto, CreateModulePaymentDto, VerifyPaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { CategoryAccessControlService } from '../categories/access-control.service';

@Controller('api/payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paystackService: PaystackService,
    private readonly categoryAccessControl: CategoryAccessControlService,
  ) {}

  /**
   * Initialize a Paystack payment for a course
   * POST /api/payments/initialize
   */
  @Post('initialize')
  @UseGuards(JwtAuthGuard)
  async initializePayment(
    @Body() dto: CreatePaymentIntentDto & { paymentType?: 'local' | 'international' },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initializePayment(user._id, dto.courseId, dto.paymentType);
  }

  /**
   * Initialize a Paystack payment for a module (pays for category access)
   * POST /api/payments/module/initialize
   */
  @Post('module/initialize')
  @UseGuards(JwtAuthGuard)
  async initializeModulePayment(
    @Body() dto: CreateModulePaymentDto & { paymentType?: 'local' | 'international' },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initializeModulePayment(user._id, dto.moduleId, dto.paymentType);
  }

  /**
   * Check payment status for a module's category
   * GET /api/payments/module/status/:moduleId
   */
  @Get('module/status/:moduleId')
  @UseGuards(JwtAuthGuard)
  async checkModulePaymentStatus(
    @Param('moduleId') moduleId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.checkModulePaymentStatus(user._id, moduleId);
  }

  /**
   * Verify Paystack payment after successful completion
   * GET /api/payments/verify/:reference
   */
  @Get('verify/:reference')
  async verifyPayment(@Param('reference') reference: string) {
    return this.paymentsService.verifyPayment(reference);
  }

  /**
   * Check if user can access a course (and if payment is required)
   * GET /api/payments/check-access/:courseId
   */
  @Get('check-access/:courseId')
  @UseGuards(JwtAuthGuard)
  async checkCourseAccess(
    @Param('courseId') courseId: string,
    @CurrentUser() user: any,
  ) {
    const accessCheck = await this.categoryAccessControl.checkCourseAccess(
      user._id,
      courseId,
    );

    return {
      allowed: accessCheck.allowed,
      requiresPayment: accessCheck.requiresPayment,
      categoryId: accessCheck.categoryId,
      price: accessCheck.price,
      reason: accessCheck.reason,
    };
  }

  /**
   * Check payment status for a specific course
   * GET /api/payments/status/:courseId
   */
  @Get('status/:courseId')
  @UseGuards(JwtAuthGuard)
  async checkPaymentStatus(
    @Param('courseId') courseId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.checkCoursePaymentStatus(user._id, courseId);
  }

  /**
   * Get user's payment history
   * GET /api/payments/my-payments
   */
  @Get('my-payments')
  @UseGuards(JwtAuthGuard)
  async getMyPayments(@CurrentUser() user: any) {
    return this.paymentsService.getUserPayments(user._id);
  }

  /**
   * Get payment details by ID
   * GET /api/payments/:id
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPaymentById(@Param('id') id: string) {
    return this.paymentsService.getPaymentById(id);
  }

  /**
   * Handle Paystack webhooks
   * POST /api/payments/webhook
   *
   * Note: This endpoint should NOT use JwtAuthGuard
   * It's authenticated via Paystack signature verification
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    if (!signature) {
      throw new Error('Missing x-paystack-signature header');
    }

    return this.paymentsService.handleWebhook(payload, signature);
  }
}
