import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaystackService } from './paystack.service';
import { CategoryAccessControlService } from '../categories/access-control.service';
import { Course } from '../schemas/course.schema';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { Module as ModuleEntity } from '../schemas/module.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(ModuleEntity.name) private moduleModel: Model<ModuleEntity>,
    private paystackService: PaystackService,
    private categoryAccessControl: CategoryAccessControlService,
    private configService: ConfigService,
  ) {}

  /**
   * Initialize a Paystack payment for a course
   * Checks access requirements and generates Paystack transaction
   */
  private getPaystackChannels(paymentType: 'local' | 'international' | undefined): string[] | undefined {
    if (paymentType === 'local') return ['bank', 'ussd', 'mobile_money', 'qr'];
    if (paymentType === 'international') return ['card'];
    return undefined; // let Paystack show all channels
  }

  async initializePayment(userId: string, courseId: string, paymentType?: 'local' | 'international') {
    // Fetch user and course with category
    const [user, course] = await Promise.all([
      this.userModel.findById(userId),
      this.courseModel.findById(courseId).populate('category'),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (!course.category) {
      throw new BadRequestException('This course has no associated category');
    }

    const category = course.category as any;

    // Check if user already has access
    const accessCheck = await this.categoryAccessControl.checkCourseAccess(
      userId,
      courseId,
    );

    if (accessCheck.allowed) {
      throw new BadRequestException('You already have access to this course');
    }

    if (!accessCheck.requiresPayment) {
      throw new BadRequestException('This course is not available for purchase');
    }

    // Get the price from category
    const amount = category.price;

    if (!amount || amount <= 0) {
      throw new BadRequestException('Invalid course price');
    }

    // Generate unique reference
    const reference = this.paystackService.generateReference('COURSE');

    // Get callback URL from config
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const callbackUrl = `${frontendUrl}/payment/verify?reference=${reference}`;

    // Initialize Paystack transaction
    const paystackResponse = await this.paystackService.initializeTransaction(
      user.email,
      amount,
      reference,
      {
        userId,
        courseId,
        categoryId: category._id.toString(),
        courseName: course.title,
        categoryName: category.name,
        userName: `${user.firstName} ${user.lastName}`,
      },
      callbackUrl,
      this.getPaystackChannels(paymentType),
    );

    // Create payment record in database
    const payment = await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      courseId: new Types.ObjectId(courseId),
      categoryId: new Types.ObjectId(category._id),
      amount,
      status: PaymentStatus.PENDING,
      paystackReference: reference,
      paystackAccessCode: paystackResponse.data.access_code,
      paystackAuthorizationUrl: paystackResponse.data.authorization_url,
      purchaseType: 'category_access',
      metadata: {
        courseName: course.title,
        categoryName: category.name,
        userEmail: user.email,
      },
    });

    this.logger.log(`Initialized Paystack payment ${reference} for user ${userId}, course ${courseId}`);

    return {
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      amount,
      paymentId: payment._id.toString(),
    };
  }

  /**
   * Verify Paystack payment and grant access
   * Called after user completes payment and is redirected back
   */
  async verifyPayment(reference: string) {
    // Find payment record in database
    const payment = await this.paymentModel.findOne({ paystackReference: reference });

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    // Check if already processed
    if (payment.status === PaymentStatus.COMPLETED) {
      return {
        success: true,
        message: 'Payment already verified',
        paymentId: payment._id.toString(),
        categoryId: payment.categoryId?.toString(),
        courseId: payment.courseId?.toString(),
        moduleId: payment.moduleId?.toString(),
      };
    }

    // Verify transaction with Paystack
    const verification = await this.paystackService.verifyTransaction(reference);

    if (!verification.status) {
      throw new BadRequestException('Failed to verify payment with Paystack');
    }

    const transactionData = verification.data;

    // Check if payment was successful
    if (transactionData.status === 'success') {
      // Update payment status
      payment.status = PaymentStatus.COMPLETED;
      payment.paystackTransactionId = transactionData.id;
      payment.metadata = {
        ...payment.metadata,
        verificationData: {
          paidAt: transactionData.paid_at,
          channel: transactionData.channel,
          currency: transactionData.currency,
          ipAddress: transactionData.ip_address,
          fees: transactionData.fees,
        },
      };
      await payment.save();

      // Grant access by adding category to user's purchasedCategories
      if (payment.categoryId) {
        await this.categoryAccessControl.markCategoryAsPurchased(
          payment.userId.toString(),
          payment.categoryId.toString(),
        );
      }

      this.logger.log(`Payment ${reference} verified and access granted for user ${payment.userId}`);

      return {
        success: true,
        message: 'Payment verified and access granted',
        paymentId: payment._id.toString(),
        categoryId: payment.categoryId?.toString(),
        courseId: payment.courseId?.toString(),
        moduleId: payment.moduleId?.toString(),
        amount: this.paystackService.fromKobo(transactionData.amount),
      };
    } else if (transactionData.status === 'failed') {
      // Payment failed
      payment.status = PaymentStatus.FAILED;
      payment.failureReason = transactionData.gateway_response || 'Payment failed';
      await payment.save();

      throw new BadRequestException(`Payment failed: ${transactionData.gateway_response}`);
    } else {
      // Payment abandoned or pending
      return {
        success: false,
        message: 'Payment was not completed',
        status: transactionData.status,
      };
    }
  }

  /**
   * Check if user has already paid for a course's category
   */
  async checkCoursePaymentStatus(userId: string, courseId: string) {
    const course = await this.courseModel.findById(courseId).populate('category');

    if (!course || !course.category) {
      return { paid: false };
    }

    const hasPaid = await this.categoryAccessControl.hasPurchasedCategory(
      userId,
      (course.category as any)._id.toString(),
    );

    return {
      paid: hasPaid,
      categoryId: (course.category as any)._id.toString(),
      categoryName: (course.category as any).name,
    };
  }

  /**
   * Handle Paystack webhooks
   * Used to process asynchronous payment events
   */
  async handleWebhook(payload: any, signature: string) {
    // Verify webhook signature
    const isValid = this.paystackService.verifyWebhookSignature(
      JSON.stringify(payload),
      signature,
    );

    if (!isValid) {
      this.logger.warn('Invalid webhook signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = payload.event;
    const data = payload.data;

    this.logger.log(`Received Paystack webhook: ${event}`);

    switch (event) {
      case 'charge.success':
        await this.handleChargeSuccess(data);
        break;

      case 'charge.failed':
        await this.handleChargeFailed(data);
        break;

      default:
        this.logger.log(`Unhandled webhook event: ${event}`);
    }

    return { received: true };
  }

  /**
   * Handle successful charge
   */
  private async handleChargeSuccess(data: any) {
    const payment = await this.paymentModel.findOne({
      paystackReference: data.reference,
    });

    if (!payment) {
      this.logger.warn(`Payment record not found for reference ${data.reference}`);
      return;
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      payment.status = PaymentStatus.COMPLETED;
      payment.paystackTransactionId = data.id;
      payment.metadata = {
        ...payment.metadata,
        webhookData: {
          paidAt: data.paid_at,
          channel: data.channel,
          currency: data.currency,
          ipAddress: data.ip_address,
        },
      };
      await payment.save();

      // Grant access
      if (payment.categoryId) {
        await this.categoryAccessControl.markCategoryAsPurchased(
          payment.userId.toString(),
          payment.categoryId.toString(),
        );
      }

      this.logger.log(`Webhook: Payment ${data.reference} completed and access granted`);
    }
  }

  /**
   * Handle failed charge
   */
  private async handleChargeFailed(data: any) {
    const payment = await this.paymentModel.findOne({
      paystackReference: data.reference,
    });

    if (!payment) {
      return;
    }

    payment.status = PaymentStatus.FAILED;
    payment.failureReason = data.gateway_response || 'Payment failed';
    await payment.save();

    this.logger.warn(`Webhook: Payment ${data.reference} failed`);
  }

  /**
   * Initialize a Paystack payment for a module (pays for the module's category)
   */
  async initializeModulePayment(userId: string, moduleId: string, paymentType?: 'local' | 'international') {
    const [user, moduleDoc] = await Promise.all([
      this.userModel.findById(userId),
      this.moduleModel.findById(moduleId).populate('categoryId'),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!moduleDoc) {
      throw new NotFoundException('Module not found');
    }

    if (!moduleDoc.categoryId) {
      throw new BadRequestException('This module has no associated category');
    }

    const category = (moduleDoc as any).categoryId;

    // Check if user already has category access
    const accessCheck = await this.categoryAccessControl.checkCategoryAccess(
      userId,
      category._id.toString(),
    );

    if (accessCheck.allowed) {
      throw new BadRequestException('You already have access to this module\'s category');
    }

    const amount = category.price;

    if (!amount || amount <= 0) {
      throw new BadRequestException('Invalid category price');
    }

    const reference = this.paystackService.generateReference('MOD');

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const callbackUrl = `${frontendUrl}/payment/verify?reference=${reference}`;

    const paystackResponse = await this.paystackService.initializeTransaction(
      user.email,
      amount,
      reference,
      {
        userId,
        moduleId,
        categoryId: category._id.toString(),
        moduleName: moduleDoc.title,
        categoryName: category.name,
        userName: `${user.firstName} ${user.lastName}`,
        purchaseType: 'category_access',
      },
      callbackUrl,
      this.getPaystackChannels(paymentType),
    );

    const payment = await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      moduleId: new Types.ObjectId(moduleId),
      categoryId: new Types.ObjectId(category._id),
      amount,
      status: PaymentStatus.PENDING,
      paystackReference: reference,
      paystackAccessCode: paystackResponse.data.access_code,
      paystackAuthorizationUrl: paystackResponse.data.authorization_url,
      purchaseType: 'category_access',
      metadata: {
        moduleName: moduleDoc.title,
        categoryName: category.name,
        userEmail: user.email,
      },
    });

    this.logger.log(`Initialized module payment ${reference} for user ${userId}, module ${moduleId}`);

    return {
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      amount,
      paymentId: payment._id.toString(),
      categoryId: category._id.toString(),
      categoryName: category.name,
    };
  }

  /**
   * Check if user has paid for a module's category
   */
  async checkModulePaymentStatus(userId: string, moduleId: string) {
    const moduleDoc = await this.moduleModel.findById(moduleId).populate('categoryId');

    if (!moduleDoc || !moduleDoc.categoryId) {
      return { paid: false };
    }

    const category = (moduleDoc as any).categoryId;

    const accessCheck = await this.categoryAccessControl.checkCategoryAccess(
      userId,
      category._id.toString(),
    );

    return {
      paid: accessCheck.allowed,
      requiresPayment: !accessCheck.allowed && accessCheck.reason === 'payment_required',
      categoryId: category._id.toString(),
      categoryName: category.name,
      price: category.price,
    };
  }

  /**
   * Get payment history for a user
   */
  async getUserPayments(userId: string) {
    return this.paymentModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('courseId', 'title')
      .populate('moduleId', 'title')
      .populate('categoryId', 'name')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(paymentId: string) {
    const payment = await this.paymentModel
      .findById(paymentId)
      .populate('courseId', 'title')
      .populate('categoryId', 'name')
      .populate('userId', 'firstName lastName email')
      .exec();

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }
}
