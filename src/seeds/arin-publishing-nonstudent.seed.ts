/**
 * Seed a test NON-STUDENT who has paid in full for "ARIN Publishing Academy".
 *
 * Payment: $200 USD  full payment, non-student tier.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-nonstudent.seed.ts
 *
 * Re-running is safe  updates existing user and skips duplicate payment records.
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
const STUDENT_EMAIL    = 'testnonstudent-publishing@arin-africa.org';
const STUDENT_PASSWORD = 'NonStudent@2024!';
const STUDENT_FIRST    = 'Test';
const STUDENT_LAST     = 'NonStudent';
const CATEGORY_NAME    = 'Arin Publishing Academy';
const PAYMENT_AMOUNT   = 200; // USD non-student full price
const USER_TIER        = 'non-student';
// ──────────────────────────────────────────────────────────────────────────────

async function seedNonStudentFull() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
  const paymentModel  = app.get<Model<Payment>>(getModelToken(Payment.name));

  // ── 1. Find ARIN Publishing Academy category ───────────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!category) {
    console.error(`\n❌  Category "${CATEGORY_NAME}" not found.`);
    await app.close();
    process.exit(1);
  }

  console.log(`✅  Category found: "${category.name}" (${category._id})`);

  // ── 1b. Ensure category is configured correctly with prices ────────────────
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

  // ── 3. Create or update user ───────────────────────────────────────────────
  const categoryId = new Types.ObjectId(String(category._id));
  let user         = await userModel.findOne({ email: STUDENT_EMAIL.toLowerCase() });

  if (user) {
    console.log(`ℹ️   User already exists  resetting password + category access.`);
    await userModel.findByIdAndUpdate(user._id, {
      password:            hashedPassword,
      mustSetPassword:     false,
      isActive:            true,
      purchasedCategories: [categoryId],
      fellowData:          null, // clear any fellow assignments so only paid category shows
    });
    user = await userModel.findById(user._id);
  } else {
    user = await userModel.create({
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
    console.log(`✅  User created.`);
  }

  // ── 4. Create completed full-payment record ────────────────────────────────
  const userId = new Types.ObjectId(String(user!._id));

  const existing = await paymentModel.findOne({
    userId,
    categoryId,
    status:        PaymentStatus.COMPLETED,
    isFullPayment: true,
  });

  if (existing) {
    console.log(`ℹ️   Full payment record already exists  skipping.`);
  } else {
    const ref = `SEED-NS-${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 14)}`;
    await paymentModel.create({
      userId,
      categoryId,
      amount:            PAYMENT_AMOUNT,
      status:            PaymentStatus.COMPLETED,
      paystackReference: ref,
      purchaseType:      PurchaseType.CATEGORY_ACCESS,
      isFullPayment:     true,
      isInstallment:     false,
      userTier:          USER_TIER,
      metadata: {
        seeded:    true,
        note:      'Created by arin-publishing-nonstudent.seed.ts for testing',
        createdAt: new Date().toISOString(),
      },
    });
    console.log(`✅  Payment record created: $${PAYMENT_AMOUNT} full payment (${USER_TIER})`);
  }

  // ── 5. Verify saved password ───────────────────────────────────────────────
  const saved      = await userModel.findById(user!._id).select('+password');
  const loginWorks = await bcrypt.compare(STUDENT_PASSWORD, saved!.password);

  if (!loginWorks) {
    console.error('\n❌  Password saved to DB does NOT match  login will fail!');
    await app.close();
    process.exit(1);
  }

  // ── 6. Report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅  Non-student (full payment) seeded successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email      : ${STUDENT_EMAIL}`);
  console.log(`🔐  Password   : ${STUDENT_PASSWORD}`);
  console.log(`📂  Category   : ${category.name}`);
  console.log(`🆔  User ID    : ${user!._id}`);
  console.log(`💳  Payment    : $${PAYMENT_AMOUNT}  full payment (${USER_TIER})`);
  console.log(`✔️   Login test : password verified against DB hash ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedNonStudentFull().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
