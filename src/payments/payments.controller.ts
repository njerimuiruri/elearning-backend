import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import {
  CreatePaymentIntentDto,
  CreateModulePaymentDto,
  CreateCategoryPaymentDto,
  VerifyPaymentDto,
} from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';
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
    @Body()
    dto: CreatePaymentIntentDto & { paymentType?: 'local' | 'international' },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initializePayment(
      user._id,
      dto.courseId,
      dto.paymentType,
    );
  }

  /**
   * Initialize a Paystack payment for a module (pays for category access)
   * POST /api/payments/module/initialize
   */
  @Post('module/initialize')
  @UseGuards(JwtAuthGuard)
  async initializeModulePayment(
    @Body()
    dto: CreateModulePaymentDto & {
      paymentType?: 'local' | 'international';
      callbackBaseUrl?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initializeModulePayment(
      user._id,
      dto.moduleId,
      dto.paymentType,
      dto.callbackBaseUrl,
      dto.userTier,
    );
  }

  /**
   * Initialize a Paystack payment directly for a category (no module required)
   * POST /api/payments/category/initialize
   */
  @Post('category/initialize')
  @UseGuards(JwtAuthGuard)
  async initializeCategoryPayment(
    @Body()
    dto: CreateCategoryPaymentDto & {
      paymentType?: 'local' | 'international';
      callbackBaseUrl?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initializeCategoryPayment(
      user._id,
      dto.categoryId,
      dto.userTier,
      dto.paymentOption,
      dto.paymentType,
      dto.callbackBaseUrl,
    );
  }

  /**
   * Check payment status for a category
   * GET /api/payments/category/status/:categoryId
   */
  @Get('category/status/:categoryId')
  @UseGuards(JwtAuthGuard)
  async checkCategoryPaymentStatus(
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.checkCategoryDirectPaymentStatus(user._id, categoryId);
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
   * Get tiered pricing info for a category (student/non-student prices)
   * GET /api/payments/category-pricing/:categoryId
   */
  @Get('category-pricing/:categoryId')
  async getCategoryPricing(@Param('categoryId') categoryId: string) {
    return this.paymentsService.getCategoryPricing(categoryId);
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
   * Admin: get all payments for a specific category
   * GET /api/payments/admin/category/:categoryId
   */
  @Get('admin/category/:categoryId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAdminCategoryPayments(
    @Param('categoryId') categoryId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.paymentsService.getAdminCategoryPayments(
      categoryId,
      Number(page),
      Number(limit),
    );
  }

  /**
   * Admin: get installment overview for a category
   * GET /api/payments/admin/category/:categoryId/installments
   */
  @Get('admin/category/:categoryId/installments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getInstallmentOverview(@Param('categoryId') categoryId: string) {
    return this.paymentsService.getInstallmentOverview(categoryId);
  }

  /**
   * Admin: send installment2 reminder emails
   * POST /api/payments/admin/category/:categoryId/send-installment2-reminders
   */
  @Post('admin/category/:categoryId/send-installment2-reminders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendInstallment2Reminders(@Param('categoryId') categoryId: string) {
    return this.paymentsService.sendInstallment2Reminders(categoryId);
  }

  /**
   * Admin: get all payments across all categories
   * GET /api/payments/admin/all
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllPayments(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('status') status?: string,
  ) {
    return this.paymentsService.getAllPayments(Number(page), Number(limit), status);
  }

  /** Enroll user as pay-later (no payment, Module 1 teaser only)
   * POST /api/payments/category/pay-later
   */
  @Post('category/pay-later')
  @UseGuards(JwtAuthGuard)
  async enrollPayLater(
    @Body() dto: { categoryId: string; tier: 'student' | 'non-student' },
    @CurrentUser() user: any,
  ) {
    await this.paymentsService.enrollPayLater(user._id, dto.categoryId, dto.tier);
    return { success: true };
  }

  /** Admin: get all pay-later enrollments for a category
   * GET /api/payments/admin/publishing-academy/:categoryId/pay-later
   */
  @Get('admin/publishing-academy/:categoryId/pay-later')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getPayLaterEnrollments(@Param('categoryId') categoryId: string) {
    return this.paymentsService.getPayLaterEnrollments(categoryId);
  }

  /** Admin: get unified fellows list (paid + pay-later)
   * GET /api/payments/admin/publishing-academy/:categoryId/fellows
   */
  @Get('admin/publishing-academy/:categoryId/fellows')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getPublishingAcademyFellows(@Param('categoryId') categoryId: string) {
    return this.paymentsService.getPublishingAcademyFellows(categoryId);
  }

  /** Admin: lock user from category
   * POST /api/payments/admin/publishing-academy/:categoryId/lock/:userId
   */
  @Post('admin/publishing-academy/:categoryId/lock/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async lockUser(@Param('categoryId') categoryId: string, @Param('userId') userId: string) {
    await this.paymentsService.lockUserFromCategory(userId, categoryId);
    return { success: true };
  }

  /** Admin: unlock user from category
   * POST /api/payments/admin/publishing-academy/:categoryId/unlock/:userId
   */
  @Post('admin/publishing-academy/:categoryId/unlock/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async unlockUser(@Param('categoryId') categoryId: string, @Param('userId') userId: string) {
    await this.paymentsService.unlockUserFromCategory(userId, categoryId);
    return { success: true };
  }

  /** Admin: send payment reminder to one pay-later user
   * POST /api/payments/admin/publishing-academy/:categoryId/send-reminder/:userId
   */
  @Post('admin/publishing-academy/:categoryId/send-reminder/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendReminder(@Param('categoryId') categoryId: string, @Param('userId') userId: string) {
    await this.paymentsService.sendPayLaterReminder(userId, categoryId);
    return { success: true };
  }

  /** Admin: send bulk payment reminders to all pay-later users
   * POST /api/payments/admin/publishing-academy/:categoryId/send-reminders-bulk
   */
  @Post('admin/publishing-academy/:categoryId/send-reminders-bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendBulkReminders(@Param('categoryId') categoryId: string) {
    return this.paymentsService.sendBulkPayLaterReminders(categoryId);
  }

  /**
   * Admin: look up a user by email  returns their category associations and
   * Publishing Academy payment status.
   * GET /api/payments/admin/user-lookup?email=
   */
  @Get('admin/user-lookup')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminLookupUserCategories(@Query('email') email: string) {
    if (!email) return { found: false };
    return this.paymentsService.adminLookupUserCategories(email);
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
