import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaystackService } from './paystack.service';
import { CategoryAccessControlService } from '../categories/access-control.service';
import { Course } from '../schemas/course.schema';
import { Category } from '../schemas/category.schema';
import { User, UserType, StudentVerificationStatus } from '../schemas/user.schema';
import { Module as ModuleEntity } from '../schemas/module.schema';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../common/services/email.service';

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
    private emailService: EmailService,
  ) {}

  /**
   * Initialize a Paystack payment for a course
   * Checks access requirements and generates Paystack transaction
   */
  private async enrollUserAsFellow(userId: string, categoryId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { userType: UserType.FELLOW },
      $addToSet: { 'fellowData.assignedCategories': new Types.ObjectId(categoryId) },
    });
    this.logger.log(`User ${userId} upgraded to fellow and assigned to category ${categoryId}`);
  }

  private getPaystackChannels(
    paymentType: 'local' | 'international' | undefined,
  ): string[] | undefined {
    return undefined; // let Paystack show all active channels on the account
  }

  async initializePayment(
    userId: string,
    courseId: string,
    paymentType?: 'local' | 'international',
  ) {
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
      throw new BadRequestException(
        'This course is not available for purchase',
      );
    }

    // Get the price from category
    const amount = category.price;

    if (!amount || amount <= 0) {
      throw new BadRequestException('Invalid course price');
    }

    // Generate unique reference
    const reference = this.paystackService.generateReference('COURSE');

    const callbackUrl = `https://elearning.arin-africa.org/payment/verify?reference=${reference}`;

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

    this.logger.log(
      `Initialized Paystack payment ${reference} for user ${userId}, course ${courseId}`,
    );

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
    const payment = await this.paymentModel.findOne({
      paystackReference: reference,
    });

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
    const verification =
      await this.paystackService.verifyTransaction(reference);

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

      // For student-priced payments: check if already verified (new flow: ID uploaded first)
      if (payment.isStudentPrice && payment.categoryId) {
        const user = await this.userModel.findById(payment.userId.toString()).select(
          'studentVerification firstName fullName email',
        );
        const isAlreadyApproved =
          user?.studentVerification?.status === StudentVerificationStatus.APPROVED;

        if (isAlreadyApproved) {
          // Student was verified before paying  grant access immediately
          await this.categoryAccessControl.markCategoryAsPurchased(
            payment.userId.toString(),
            payment.categoryId.toString(),
          );
          await this.enrollUserAsFellow(payment.userId.toString(), payment.categoryId.toString());
          await this.userModel.findByIdAndUpdate(payment.userId.toString(), {
            'studentVerification.awaitingPayment': false,
            pendingStudentCategoryId: null,
          });

          // Send congratulations email
          const firstName = user.firstName || user.fullName?.split(' ')[0] || 'Participant';
          try {
            await this.emailService.sendAcademyRegistrationEmail(user.email, firstName);
          } catch (err) {
            this.logger.warn(`Failed to send congrats email to ${user.email}`);
          }

          this.logger.log(`Student payment ${reference} verified  access granted (pre-verified)`);
          return {
            success: true,
            requiresStudentVerification: false,
            message: 'Payment verified and access granted.',
            paymentId: payment._id.toString(),
            categoryId: payment.categoryId?.toString(),
            amount: this.paystackService.fromCents(transactionData.amount),
          };
        }

        // Student not yet verified  ask them to upload ID
        await this.userModel.findByIdAndUpdate(payment.userId.toString(), {
          pendingStudentCategoryId: payment.categoryId,
          'studentVerification.status': StudentVerificationStatus.NONE,
        });

        this.logger.log(`Student payment ${reference} verified  awaiting ID upload`);
        return {
          success: true,
          requiresStudentVerification: true,
          message: 'Payment successful. Please upload your student ID to access the content.',
          paymentId: payment._id.toString(),
          categoryId: payment.categoryId?.toString(),
          moduleId: payment.moduleId?.toString(),
          amount: this.paystackService.fromCents(transactionData.amount),
        };
      }

      // Non-student price  grant access immediately
      if (payment.categoryId) {
        await this.categoryAccessControl.markCategoryAsPurchased(
          payment.userId.toString(),
          payment.categoryId.toString(),
        );
        await this.enrollUserAsFellow(payment.userId.toString(), payment.categoryId.toString());

        // Send congratulations email
        const user = await this.userModel.findById(payment.userId.toString()).select(
          'firstName fullName email',
        );
        if (user) {
          const firstName = user.firstName || user.fullName?.split(' ')[0] || 'Participant';
          try {
            await this.emailService.sendAcademyRegistrationEmail(user.email, firstName);
          } catch (err) {
            this.logger.warn(`Failed to send congrats email to ${user.email}`);
          }
        }
      }

      this.logger.log(`Payment ${reference} verified and access granted for user ${payment.userId}`);

      return {
        success: true,
        requiresStudentVerification: false,
        message: 'Payment verified and access granted',
        paymentId: payment._id.toString(),
        categoryId: payment.categoryId?.toString(),
        courseId: payment.courseId?.toString(),
        moduleId: payment.moduleId?.toString(),
        amount: this.paystackService.fromCents(transactionData.amount),
      };
    } else if (transactionData.status === 'failed') {
      // Payment failed
      payment.status = PaymentStatus.FAILED;
      payment.failureReason =
        transactionData.gateway_response || 'Payment failed';
      await payment.save();

      throw new BadRequestException(
        `Payment failed: ${transactionData.gateway_response}`,
      );
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
   * Check payment status for a category directly
   */
  async checkCategoryDirectPaymentStatus(userId: string, categoryId: string) {
    const user = await this.userModel.findById(userId).select(
      'studentVerification pendingStudentCategoryId purchasedCategories payLaterEnrollments lockedFromCategories',
    );
    if (!user) throw new NotFoundException('User not found');

    const accessCheck = await this.categoryAccessControl.checkCategoryAccess(userId, categoryId);

    const catObjId = new Types.ObjectId(categoryId);
    const userObjId = new Types.ObjectId(userId);

    const [installment1, installment2, fullPayment] = await Promise.all([
      this.paymentModel.findOne({
        userId: userObjId, categoryId: catObjId,
        status: PaymentStatus.COMPLETED, installmentNumber: 1,
      }).select('amount userTier'),
      this.paymentModel.findOne({
        userId: userObjId, categoryId: catObjId,
        status: PaymentStatus.COMPLETED, installmentNumber: 2,
      }).select('amount'),
      this.paymentModel.findOne({
        userId: userObjId, categoryId: catObjId,
        status: PaymentStatus.COMPLETED, isFullPayment: true,
      }).select('amount userTier'),
    ]);

    let installmentInfo: { isInstallment: boolean; installment1Paid: boolean; installment2Paid: boolean; paidAmount: number; balanceDue: number; userTier: string | undefined } | null = null;
    if (installment1) {
      installmentInfo = {
        isInstallment: true,
        installment1Paid: true,
        installment2Paid: !!installment2,
        paidAmount: installment1.amount + (installment2?.amount || 0),
        balanceDue: installment2 ? 0 : installment1.amount,
        userTier: installment1.userTier,
      };
    }

    const payLaterEnrollment = (user as any).payLaterEnrollments?.find(
      (e: any) => e.categoryId?.toString() === categoryId,
    );

    return {
      hasAccess: accessCheck.allowed,
      verificationStatus: user.studentVerification?.status || 'none',
      awaitingPayment: user.studentVerification?.awaitingPayment || false,
      pendingCategoryId: user.pendingStudentCategoryId?.toString() || null,
      reason: accessCheck.reason,
      userTier: fullPayment?.userTier || installment1?.userTier || payLaterEnrollment?.tier || null,
      installmentInfo,
      isPayLater: !!payLaterEnrollment,
    };
  }

  /**
   * Check if user has already paid for a course's category
   */
  async checkCoursePaymentStatus(userId: string, courseId: string) {
    const course = await this.courseModel
      .findById(courseId)
      .populate('category');

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
      this.logger.warn(
        `Payment record not found for reference ${data.reference}`,
      );
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

      // Student-priced: mark pending verification, don't grant access yet
      if (payment.isStudentPrice && payment.categoryId) {
        await this.userModel.findByIdAndUpdate(payment.userId.toString(), {
          pendingStudentCategoryId: payment.categoryId,
          'studentVerification.status': 'none',
        });
        this.logger.log(`Webhook: Student payment ${data.reference} completed  awaiting ID upload`);
        return;
      }

      // Non-student: grant access immediately
      if (payment.categoryId) {
        await this.categoryAccessControl.markCategoryAsPurchased(
          payment.userId.toString(),
          payment.categoryId.toString(),
        );
        await this.enrollUserAsFellow(payment.userId.toString(), payment.categoryId.toString());
      }

      this.logger.log(
        `Webhook: Payment ${data.reference} completed and access granted`,
      );
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
   * Supports tiered pricing (student $100 / non-student $200) for categories with hasTieredPricing=true
   */
  async initializeModulePayment(
    userId: string,
    moduleId: string,
    paymentType?: 'local' | 'international',
    callbackBaseUrl?: string,
    userTier?: 'student' | 'non-student',
  ) {
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
      throw new BadRequestException(
        "You already have access to this module's category",
      );
    }

    // Determine amount based on tiered pricing
    let amount: number;
    let isStudentPrice = false;

    if (category.hasTieredPricing) {
      if (!userTier) {
        throw new BadRequestException(
          'Please select your tier: student or non-student',
        );
      }
      if (userTier === 'student') {
        if (!category.studentPrice || category.studentPrice <= 0) {
          throw new BadRequestException('Student price not configured for this category');
        }
        amount = category.studentPrice;
        isStudentPrice = true;
      } else {
        if (!category.nonStudentPrice || category.nonStudentPrice <= 0) {
          throw new BadRequestException('Non-student price not configured for this category');
        }
        amount = category.nonStudentPrice;
      }
    } else {
      amount = category.price;
    }

    if (!amount || amount <= 0) {
      throw new BadRequestException('Invalid category price');
    }

    const reference = this.paystackService.generateReference('MOD');

    const callbackUrl = `https://elearning.arin-africa.org/payment/verify?reference=${reference}`;

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
        userTier: userTier || 'non-student',
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
      isStudentPrice,
      userTier: userTier || 'non-student',
      metadata: {
        moduleName: moduleDoc.title,
        categoryName: category.name,
        userEmail: user.email,
        userTier: userTier || 'non-student',
      },
    });

    this.logger.log(
      `Initialized module payment ${reference} for user ${userId}, module ${moduleId}, tier: ${userTier || 'non-student'}`,
    );

    return {
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      amount,
      paymentId: payment._id.toString(),
      categoryId: category._id.toString(),
      categoryName: category.name,
      isStudentPrice,
      userTier: userTier || 'non-student',
    };
  }

  /**
   * Check if user has paid for a module's category
   */
  async checkModulePaymentStatus(userId: string, moduleId: string) {
    const moduleDoc = await this.moduleModel
      .findById(moduleId)
      .populate('categoryId');

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
      requiresPayment:
        !accessCheck.allowed && accessCheck.reason === 'payment_required',
      reason: accessCheck.reason,
      verificationStatus: accessCheck.verificationStatus,
      rejectionReason: accessCheck.rejectionReason,
      categoryId: category._id.toString(),
      categoryName: category.name,
      hasTieredPricing: category.hasTieredPricing || false,
      studentPrice: category.studentPrice || 0,
      nonStudentPrice: category.nonStudentPrice || 0,
      price: category.price,
    };
  }

  /**
   * Initialize a Paystack payment directly for a category (no module required)
   * Supports tiered pricing and installment options
   */
  async initializeCategoryPayment(
    userId: string,
    categoryId: string,
    userTier: 'student' | 'non-student',
    paymentOption: 'full' | 'installment1' | 'installment2',
    paymentType?: 'local' | 'international',
    callbackBaseUrl?: string,
  ) {
    const [user, category] = await Promise.all([
      this.userModel.findById(userId),
      this.categoryModel.findById(categoryId),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!category) throw new NotFoundException('Category not found');

    // For installment2: user already has access, so skip the access check
    if (paymentOption !== 'installment2') {
      const accessCheck = await this.categoryAccessControl.checkCategoryAccess(userId, categoryId);
      if (accessCheck.allowed) {
        throw new BadRequestException('You already have access to this category');
      }
    }

    // Validate installment2: must have already paid installment1
    if (paymentOption === 'installment2') {
      const installment1 = await this.paymentModel.findOne({
        userId: new Types.ObjectId(userId),
        categoryId: new Types.ObjectId(categoryId),
        status: PaymentStatus.COMPLETED,
        installmentNumber: 1,
      });
      if (!installment1) {
        throw new BadRequestException('No completed first installment found for this category');
      }
      const installment2Exists = await this.paymentModel.findOne({
        userId: new Types.ObjectId(userId),
        categoryId: new Types.ObjectId(categoryId),
        status: PaymentStatus.COMPLETED,
        installmentNumber: 2,
      });
      if (installment2Exists) {
        throw new BadRequestException('Second installment already paid');
      }
    }

    let fullAmount: number;
    let isStudentPrice = false;

    if (category.hasTieredPricing) {
      if (userTier === 'student') {
        if (!category.studentPrice || category.studentPrice <= 0) {
          throw new BadRequestException('Student price not configured for this category');
        }
        fullAmount = category.studentPrice;
        isStudentPrice = true;
      } else {
        if (!category.nonStudentPrice || category.nonStudentPrice <= 0) {
          throw new BadRequestException('Non-student price not configured for this category');
        }
        fullAmount = category.nonStudentPrice;
      }
    } else {
      fullAmount = category.price;
    }

    if (!fullAmount || fullAmount <= 0) throw new BadRequestException('Invalid category price');

    // Installment1 and installment2 are each 50% of full price
    const isInstallment = paymentOption === 'installment1' || paymentOption === 'installment2';
    const installmentNum = paymentOption === 'installment1' ? 1 : paymentOption === 'installment2' ? 2 : null;
    const amount = isInstallment ? Math.round(fullAmount * 0.5) : fullAmount;

    const reference = this.paystackService.generateReference('CAT');
    const callbackUrl = `https://elearning.arin-africa.org/payment/verify?reference=${reference}`;

    const paystackResponse = await this.paystackService.initializeTransaction(
      user.email,
      amount,
      reference,
      {
        userId,
        categoryId,
        categoryName: category.name,
        userName: `${user.firstName} ${user.lastName}`,
        purchaseType: 'category_access',
        userTier,
        paymentOption,
      },
      callbackUrl,
      this.getPaystackChannels(paymentType),
      'USD',
    );

    const payment = await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      categoryId: new Types.ObjectId(categoryId),
      amount,
      status: PaymentStatus.PENDING,
      paystackReference: reference,
      paystackAccessCode: paystackResponse.data.access_code,
      paystackAuthorizationUrl: paystackResponse.data.authorization_url,
      purchaseType: 'category_access',
      isStudentPrice,
      userTier,
      isInstallment,
      installmentNumber: installmentNum,
      isFullPayment: !isInstallment,
      metadata: {
        categoryName: category.name,
        userEmail: user.email,
        userTier,
        paymentOption,
        fullAmount,
      },
    });

    this.logger.log(
      `Initialized category payment ${reference} for user ${userId}, category ${categoryId}, tier: ${userTier}, option: ${paymentOption}`,
    );

    return {
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      amount,
      fullAmount,
      paymentId: payment._id.toString(),
      categoryId,
      categoryName: category.name,
      isStudentPrice,
      userTier,
      paymentOption,
      isInstallment,
    };
  }

  /**
   * Get tiered pricing info for a category
   */
  async getCategoryPricing(categoryId: string) {
    const category = await this.categoryModel.findById(categoryId);
    if (!category) throw new NotFoundException('Category not found');
    return {
      hasTieredPricing: category.hasTieredPricing || false,
      studentPrice: category.studentPrice || 0,
      nonStudentPrice: category.nonStudentPrice || 0,
      price: category.price || 0,
      name: category.name,
    };
  }

  /**
   * Admin: get installment overview for a category
   * Returns who has paid installment1, who still owes installment2
   */
  async getInstallmentOverview(categoryId: string) {
    const catObjId = new Types.ObjectId(categoryId);

    // All completed installment1 payments
    const installment1Payments = await this.paymentModel
      .find({ categoryId: catObjId, status: PaymentStatus.COMPLETED, installmentNumber: 1 })
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .exec();

    // All completed installment2 payments
    const installment2Payments = await this.paymentModel
      .find({ categoryId: catObjId, status: PaymentStatus.COMPLETED, installmentNumber: 2 })
      .select('userId')
      .exec();

    const paidInstallment2UserIds = new Set(
      installment2Payments.map(p => p.userId.toString()),
    );

    const overview = installment1Payments.map(p => {
      const userId = p.userId._id?.toString() || p.userId.toString();
      return {
        userId,
        user: p.userId,
        amount1: p.amount,
        userTier: p.userTier,
        paidAt: p.createdAt,
        hasPaidInstallment2: paidInstallment2UserIds.has(userId),
      };
    });

    const owingInstallment2 = overview.filter(o => !o.hasPaidInstallment2);
    const completedBoth = overview.filter(o => o.hasPaidInstallment2);

    return {
      total: overview.length,
      owingInstallment2: owingInstallment2.length,
      completedBoth: completedBoth.length,
      overview,
    };
  }

  /**
   * Admin: send installment2 reminder emails to everyone who owes it
   */
  async sendInstallment2Reminders(categoryId: string) {
    const { overview } = await this.getInstallmentOverview(categoryId);
    const owing = overview.filter(o => !o.hasPaidInstallment2);

    if (owing.length === 0) {
      return { sent: 0, message: 'Everyone has already paid both installments.' };
    }

    let sent = 0;
    const failed: string[] = [];

    for (const record of owing) {
      const user = record.user as any;
      const paymentUrl = `https://elearning.arin-africa.org/arin-publishing-academy?action=pay-installment2`;
      const firstName = user.firstName || user.fullName?.split(' ')[0] || 'Participant';
      try {
        await this.emailService.sendInstallment2ReminderEmail(
          user.email,
          firstName,
          record.amount1, // installment2 = same amount as installment1
          record.userTier || 'non-student',
          paymentUrl,
        );
        sent++;
      } catch (e) {
        this.logger.warn(`Failed to send installment2 reminder to ${user.email}: ${e.message}`);
        failed.push(user.email);
      }
    }

    this.logger.log(`Sent installment2 reminders: ${sent} sent, ${failed.length} failed`);
    return { sent, failed: failed.length, total: owing.length };
  }

  /**
   * Admin: get all payments for a specific category (e.g. Arin Publishing Academy)
   */
  async getAdminCategoryPayments(categoryId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const filter: any = {
      categoryId: new Types.ObjectId(categoryId),
      status: PaymentStatus.COMPLETED,
    };

    const [payments, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('userId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.paymentModel.countDocuments(filter),
    ]);

    const totalRevenue = await this.paymentModel.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    return {
      payments,
      total,
      page,
      limit,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin: get all payments across all categories
   */
  async getAllPayments(page = 1, limit = 50, status?: string) {
    const skip = (page - 1) * limit;
    const filter: any = {};
    if (status) filter.status = status;

    const [payments, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('userId', 'firstName lastName email')
        .populate('categoryId', 'name')
        .populate('moduleId', 'title')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.paymentModel.countDocuments(filter),
    ]);

    return { payments, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  /**
   * Admin: look up a user by email and return their category associations
   * plus their Publishing Academy payment status.
   */
  async adminLookupUserCategories(email: string) {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .populate('fellowData.assignedCategories', 'name accessType hasTieredPricing')
      .populate('purchasedCategories', 'name accessType hasTieredPricing')
      .select('firstName lastName email role userType fellowData purchasedCategories studentVerification pendingStudentCategoryId')
      .lean();

    if (!user) return { found: false };

    // Find the Publishing Academy category
    const publishingAcademy = await this.categoryModel.findOne({
      $or: [
        { name: { $regex: /publishing academy/i } },
        { name: { $regex: /arin publishing/i } },
      ],
    }).select('_id name').lean();

    const assignedCategories: any[] = (user.fellowData as any)?.assignedCategories || [];
    const purchasedCategories: any[] = (user as any).purchasedCategories || [];

    let academyStatus: 'paid' | 'assigned_free' | 'pending_verification' | 'not_enrolled' = 'not_enrolled';
    let academyId: string | null = publishingAcademy ? publishingAcademy._id.toString() : null;

    if (academyId) {
      const hasPurchased = purchasedCategories.some(
        (c: any) => c._id?.toString() === academyId || c.toString?.() === academyId,
      );
      const isAssigned = assignedCategories.some(
        (c: any) => c._id?.toString() === academyId || c.toString?.() === academyId,
      );

      if (hasPurchased) {
        academyStatus = 'paid';
      } else if (isAssigned) {
        academyStatus = 'assigned_free';
      } else if (
        (user as any).studentVerification?.status === 'pending' ||
        (user as any).studentVerification?.status === 'approved'
      ) {
        const pendingCat = (user as any).pendingStudentCategoryId?.toString();
        if (pendingCat === academyId) academyStatus = 'pending_verification';
      }
    }

    return {
      found: true,
      user: {
        id: (user as any)._id?.toString(),
        firstName: (user as any).firstName,
        lastName: (user as any).lastName,
        email: (user as any).email,
        role: (user as any).role,
        userType: (user as any).userType,
      },
      assignedCategories: assignedCategories.map((c: any) =>
        c.name ? { id: c._id?.toString(), name: c.name } : { id: c.toString(), name: null },
      ),
      purchasedCategories: purchasedCategories.map((c: any) =>
        c.name ? { id: c._id?.toString(), name: c.name } : { id: c.toString(), name: null },
      ),
      publishingAcademy: academyId
        ? { id: academyId, name: publishingAcademy!.name, status: academyStatus }
        : null,
    };
  }

  /** Enroll user in a category without payment (pay-later / teaser access) */
  async enrollPayLater(userId: string, categoryId: string, tier: 'student' | 'non-student'): Promise<void> {
    const [user, category] = await Promise.all([
      this.userModel.findById(userId).select('purchasedCategories payLaterEnrollments'),
      this.categoryModel.findById(categoryId).select('_id'),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!category) throw new NotFoundException('Category not found');

    const catObjId = new Types.ObjectId(categoryId);
    const alreadyPurchased = user.purchasedCategories?.some((c) => c.toString() === categoryId);
    const alreadyPayLater = (user as any).payLaterEnrollments?.some(
      (e: any) => e.categoryId?.toString() === categoryId,
    );
    if (alreadyPurchased || alreadyPayLater) return;

    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: {
        payLaterEnrollments: { categoryId: catObjId, tier, enrolledAt: new Date() },
      },
    });
    this.logger.log(`User ${userId} enrolled pay-later for category ${categoryId} (${tier})`);
  }

  /** Admin: get all pay-later enrolled users for a category */
  async getPayLaterEnrollments(categoryId: string) {
    const catObjId = new Types.ObjectId(categoryId);
    const users = await this.userModel
      .find({ 'payLaterEnrollments.categoryId': catObjId })
      .select('firstName lastName email payLaterEnrollments lockedFromCategories')
      .lean();

    return users.map((u: any) => {
      const enrollment = u.payLaterEnrollments?.find(
        (e: any) => e.categoryId?.toString() === categoryId,
      );
      return {
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        tier: enrollment?.tier || 'non-student',
        enrolledAt: enrollment?.enrolledAt,
        isLocked: u.lockedFromCategories?.some((c: any) => c.toString() === categoryId) || false,
        paymentStatus: 'pay_later',
      };
    });
  }

  /** Admin: get unified Publishing Academy fellows list (paid + pay-later) */
  async getPublishingAcademyFellows(categoryId: string) {
    const catObjId = new Types.ObjectId(categoryId);

    const [paidPayments, payLaterUsers] = await Promise.all([
      this.paymentModel
        .find({ categoryId: catObjId, status: PaymentStatus.COMPLETED })
        .populate('userId', 'firstName lastName email lockedFromCategories')
        .sort({ createdAt: -1 })
        .lean(),
      this.userModel
        .find({ 'payLaterEnrollments.categoryId': catObjId })
        .select('firstName lastName email payLaterEnrollments lockedFromCategories purchasedCategories')
        .lean(),
    ]);

    const paidUserIds = new Set(
      paidPayments.map((p: any) => p.userId?._id?.toString()).filter(Boolean),
    );

    const payLaterList = payLaterUsers
      .filter((u: any) => !paidUserIds.has(u._id?.toString()))
      .map((u: any) => {
        const enrollment = u.payLaterEnrollments?.find(
          (e: any) => e.categoryId?.toString() === categoryId,
        );
        return {
          _id: u._id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          tier: enrollment?.tier || 'non-student',
          enrolledAt: enrollment?.enrolledAt,
          isLocked: u.lockedFromCategories?.some((c: any) => c.toString() === categoryId) || false,
          source: 'pay_later',
          paymentStatus: 'pay_later',
          amount: 0,
        };
      });

    return { paid: paidPayments, payLater: payLaterList };
  }

  /** Admin: lock a user from accessing a category */
  async lockUserFromCategory(userId: string, categoryId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { lockedFromCategories: new Types.ObjectId(categoryId) },
    });
    this.logger.log(`User ${userId} locked from category ${categoryId}`);
  }

  /** Admin: unlock a user from a category */
  async unlockUserFromCategory(userId: string, categoryId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { lockedFromCategories: new Types.ObjectId(categoryId) },
    });
    this.logger.log(`User ${userId} unlocked from category ${categoryId}`);
  }

  /** Admin: send payment reminder to a single pay-later user */
  async sendPayLaterReminder(userId: string, categoryId: string): Promise<void> {
    const [user, category] = await Promise.all([
      this.userModel.findById(userId).select('firstName email'),
      this.categoryModel.findById(categoryId).select('name studentPrice nonStudentPrice'),
    ]);
    if (!user || !category) throw new NotFoundException('User or category not found');

    const enrollment = await this.userModel
      .findById(userId)
      .select('payLaterEnrollments')
      .lean() as any;
    const tier = enrollment?.payLaterEnrollments?.find(
      (e: any) => e.categoryId?.toString() === categoryId,
    )?.tier || 'non-student';

    const price = tier === 'student'
      ? ((category as any).studentPrice || 100)
      : ((category as any).nonStudentPrice || 200);

    const frontendUrl = this.configService.get('FRONTEND_URL') || 'https://elearning.arin-africa.org';
    const paymentUrl = `${frontendUrl}/arin-publishing-academy`;
    const firstName = (user as any).firstName || 'Participant';

    await this.emailService.sendSimpleEmail(
      (user as any).email,
      `Complete your ${(category as any).name} registration`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#021d49">Complete Your Registration</h2>
        <p>Dear ${firstName},</p>
        <p>You enrolled in the <strong>${(category as any).name}</strong> with pay-later access.
        You currently have access to <strong>Module 1</strong> only.</p>
        <p>Complete your payment of <strong>USD ${price}</strong> to unlock all modules.</p>
        <a href="${paymentUrl}" style="display:inline-block;background:#021d49;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Complete Payment
        </a>
        <p style="color:#666;font-size:0.85em">If you have questions, contact us at info@arin-africa.org</p>
      </div>`,
    );
  }

  /** Admin: send payment reminders to all pay-later users for a category */
  async sendBulkPayLaterReminders(categoryId: string): Promise<{ sent: number; failed: number; total: number }> {
    const catObjId = new Types.ObjectId(categoryId);
    const users = await this.userModel
      .find({ 'payLaterEnrollments.categoryId': catObjId })
      .select('_id')
      .lean();

    let sent = 0;
    const failed: string[] = [];
    for (const u of users) {
      try {
        await this.sendPayLaterReminder((u as any)._id.toString(), categoryId);
        sent++;
      } catch (e) {
        this.logger.warn(`Reminder failed for user ${(u as any)._id}: ${e.message}`);
        failed.push((u as any)._id.toString());
      }
    }
    return { sent, failed: failed.length, total: users.length };
  }
}
