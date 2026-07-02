/**
 * Seed a test student who has fully paid for "ARIN Publishing Academy".
 *
 * Creates:
 *  - A student user with purchasedCategories including ARIN Publishing Academy
 *  - A completed Payment record (full payment, non-student tier)
 *  - Ensures the category is configured as hasTieredPricing=true, isPaid=true
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-paid.seed.ts
 *
 * Re-running is safe  skips creation if email already exists and updates instead.
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

// ── Credentials ───────────────────────────────────────────────────────────────
const STUDENT_EMAIL    = 'testpublishing@arin-africa.org';
const STUDENT_PASSWORD = 'Publishing@2024!';
const STUDENT_FIRST    = 'Test';
const STUDENT_LAST     = 'Publishing';
const CATEGORY_NAME    = 'Arin Publishing Academy';
const PAYMENT_AMOUNT   = 200; // USD non-student price
const USER_TIER        = 'non-student';
// ──────────────────────────────────────────────────────────────────────────────

async function seedPublishingPaidStudent() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
  const paymentModel  = app.get<Model<Payment>>(getModelToken(Payment.name));

  // ── 1. Find the ARIN Publishing Academy category ───────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
  });

  if (!category) {
    console.error(`\n❌  Category "${CATEGORY_NAME}" not found.`);
    console.error(`   Run the categories seed first:\n   npx ts-node -r tsconfig-paths/register src/seeds/categories.seed.ts\n`);
    await app.close();
    process.exit(1);
  }

  console.log(`✅  Category found: "${category.name}" (${category._id})`);

  // ── 1b. Ensure category is configured as paid/tiered with correct prices ──
  await categoryModel.findByIdAndUpdate(category._id, {
    hasTieredPricing: true,
    isPaid:           true,
    accessType:       'paid',
    studentPrice:     100,
    nonStudentPrice:  200,
  });
  console.log(`✅  Category configured: hasTieredPricing=true, studentPrice=$100, nonStudentPrice=$200`);

  // ── 2. Hash password ───────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash(STUDENT_PASSWORD, 10);
  const check = await bcrypt.compare(STUDENT_PASSWORD, hashedPassword);
  if (!check) {
    console.error('❌  bcrypt sanity check failed  aborting.');
    await app.close();
    process.exit(1);
  }

  // ── 3. Create or update the student ───────────────────────────────────────
  const categoryId = new Types.ObjectId(String(category._id));
  let student      = await userModel.findOne({ email: STUDENT_EMAIL.toLowerCase() });

  if (student) {
    console.log(`ℹ️   Student already exists  updating password + category access.`);
    await userModel.findByIdAndUpdate(student._id, {
      password:            hashedPassword,
      mustSetPassword:     false,
      isActive:            true,
      purchasedCategories: [categoryId],
    });
    student = await userModel.findById(student._id);
  } else {
    student = await userModel.create({
      firstName:           STUDENT_FIRST,
      lastName:            STUDENT_LAST,
      fullName:            `${STUDENT_FIRST} ${STUDENT_LAST}`,
      email:               STUDENT_EMAIL.toLowerCase(),
      password:            hashedPassword,
      role:                UserRole.STUDENT,
      userType:            UserType.PUBLIC,
      isActive:            true,
      emailVerified:       true,
      mustSetPassword:     false,
      purchasedCategories: [categoryId],
    });
    console.log(`✅  Student created.`);
  }

  // ── 4. Create a completed payment record ───────────────────────────────────
  const userId = new Types.ObjectId(String(student!._id));

  // Check if a completed payment already exists
  const existingPayment = await paymentModel.findOne({
    userId,
    categoryId,
    status:      PaymentStatus.COMPLETED,
    isFullPayment: true,
  });

  if (existingPayment) {
    console.log(`ℹ️   Completed payment record already exists  skipping.`);
  } else {
    const fakeReference = `SEED-${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 16)}`;
    await paymentModel.create({
      userId,
      categoryId,
      amount:        PAYMENT_AMOUNT,
      status:        PaymentStatus.COMPLETED,
      paystackReference: fakeReference,
      purchaseType:  PurchaseType.CATEGORY_ACCESS,
      isFullPayment: true,
      isInstallment: false,
      userTier:      USER_TIER,
      metadata: {
        seeded:    true,
        note:      'Created by arin-publishing-paid.seed.ts for testing',
        createdAt: new Date().toISOString(),
      },
    });
    console.log(`✅  Payment record created: USD ${PAYMENT_AMOUNT} (${USER_TIER}, full payment)`);
  }

  // ── 5. Verify saved password ───────────────────────────────────────────────
  const saved      = await userModel.findById(student!._id).select('+password');
  const loginWorks = await bcrypt.compare(STUDENT_PASSWORD, saved!.password);

  if (!loginWorks) {
    console.error('\n❌  Password saved to DB does NOT match  login will fail!');
    await app.close();
    process.exit(1);
  }

  // ── 6. Report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅  ARIN Publishing Academy paid student seeded successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email      : ${STUDENT_EMAIL}`);
  console.log(`🔐  Password   : ${STUDENT_PASSWORD}`);
  console.log(`📂  Category   : ${category.name}`);
  console.log(`🆔  User ID    : ${student!._id}`);
  console.log(`💳  Payment    : USD ${PAYMENT_AMOUNT}  full payment (${USER_TIER})`);
  console.log(`✔️   Login test : password verified against DB hash ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedPublishingPaidStudent().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
