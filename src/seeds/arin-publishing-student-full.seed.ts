/**
 * Seed: Student who has paid IN FULL for "ARIN Publishing Academy".
 *
 * Payment: $100 USD  full payment, student tier.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-student-full.seed.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserRole, UserType } from '../schemas/user.schema';
import { Category } from '../schemas/category.schema';
import { Payment, PaymentStatus, PurchaseType } from '../payments/entities/payment.entity';

const STUDENT_EMAIL    = 'teststudent-full@arin-africa.org';
const STUDENT_PASSWORD = 'StudentFull@2024!';
const STUDENT_FIRST    = 'Test';
const STUDENT_LAST     = 'StudentFull';
const CATEGORY_NAME    = 'Arin Publishing Academy';
const PAYMENT_AMOUNT   = 100; // USD full student price
const USER_TIER        = 'student';

async function seed() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
  const paymentModel  = app.get<Model<Payment>>(getModelToken(Payment.name));

  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!category) {
    console.error(`❌  Category "${CATEGORY_NAME}" not found.`);
    await app.close(); process.exit(1);
  }
  console.log(`✅  Category found: "${category.name}" (${category._id})`);

  await categoryModel.findByIdAndUpdate(category._id, {
    hasTieredPricing: true, isPaid: true, accessType: 'paid',
    studentPrice: 100, nonStudentPrice: 200,
  });
  console.log(`✅  Category configured: studentPrice=$100, nonStudentPrice=$200`);

  const hashedPassword = await bcrypt.hash(STUDENT_PASSWORD, 10);
  const categoryId     = new Types.ObjectId(String(category._id));
  let user             = await userModel.findOne({ email: STUDENT_EMAIL.toLowerCase() });

  if (user) {
    console.log(`ℹ️   User already exists  updating.`);
    await userModel.findByIdAndUpdate(user._id, {
      password: hashedPassword, mustSetPassword: false,
      isActive: true, purchasedCategories: [categoryId], fellowData: null,
    });
    user = await userModel.findById(user._id);
  } else {
    user = await userModel.create({
      firstName: STUDENT_FIRST, lastName: STUDENT_LAST,
      fullName: `${STUDENT_FIRST} ${STUDENT_LAST}`,
      email: STUDENT_EMAIL.toLowerCase(), password: hashedPassword,
      role: UserRole.STUDENT, userType: UserType.PUBLIC,
      isActive: true, emailVerified: true, mustSetPassword: false,
      purchasedCategories: [categoryId],
    });
    console.log(`✅  User created.`);
  }

  const userId = new Types.ObjectId(String(user!._id));
  const existing = await paymentModel.findOne({
    userId, categoryId, status: PaymentStatus.COMPLETED, isFullPayment: true,
  });

  if (existing) {
    console.log(`ℹ️   Full payment record already exists  skipping.`);
  } else {
    const ref = `SEED-SF-${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 14)}`;
    await paymentModel.create({
      userId, categoryId, amount: PAYMENT_AMOUNT,
      status: PaymentStatus.COMPLETED, paystackReference: ref,
      purchaseType: PurchaseType.CATEGORY_ACCESS,
      isFullPayment: true, isInstallment: false, userTier: USER_TIER,
      metadata: { seeded: true, note: 'arin-publishing-student-full.seed.ts', createdAt: new Date().toISOString() },
    });
    console.log(`✅  Payment record: $${PAYMENT_AMOUNT} full payment (${USER_TIER})`);
  }

  const saved      = await userModel.findById(user!._id).select('+password');
  const loginWorks = await bcrypt.compare(STUDENT_PASSWORD, saved!.password);
  if (!loginWorks) {
    console.error('❌  Password mismatch  login will fail!');
    await app.close(); process.exit(1);
  }

  console.log('');
  console.log('✅  Student (full payment) seeded successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email      : ${STUDENT_EMAIL}`);
  console.log(`🔐  Password   : ${STUDENT_PASSWORD}`);
  console.log(`📂  Category   : ${category.name}`);
  console.log(`🆔  User ID    : ${user!._id}`);
  console.log(`💳  Payment    : $${PAYMENT_AMOUNT}  full payment (${USER_TIER})`);
  console.log(`✔️   Login test : password verified ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seed().catch((err) => { console.error('❌  Seed crashed:', err); process.exit(1); });
