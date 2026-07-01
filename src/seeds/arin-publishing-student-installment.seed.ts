/**
 * Seed a test student (student tier) who has paid Installment 1 for "ARIN Publishing Academy".
 *
 * Installment breakdown (student price = $100):
 *   Installment 1 — $50  → paid (grants immediate access)
 *   Installment 2 — $50  → still owed
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-student-installment.seed.ts
 *
 * Re-running is safe — updates existing user and skips duplicate payment records.
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
const STUDENT_EMAIL    = 'teststudent-publishing@arin-africa.org';
const STUDENT_PASSWORD = 'StudentPublishing@2024!';
const STUDENT_FIRST    = 'Test';
const STUDENT_LAST     = 'StudentInstallment';
const CATEGORY_NAME    = 'Arin Publishing Academy';
const STUDENT_FULL_PRICE   = 100; // USD full student price
const INSTALLMENT_AMOUNT   = Math.round(STUDENT_FULL_PRICE * 0.5); // $50 — each installment is 50%
const USER_TIER            = 'student';
// ──────────────────────────────────────────────────────────────────────────────

async function seedStudentInstallment() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
  const paymentModel  = app.get<Model<Payment>>(getModelToken(Payment.name));

  // ── 1. Find the ARIN Publishing Academy category ───────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 });

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
    console.error('❌  bcrypt sanity check failed — aborting.');
    await app.close();
    process.exit(1);
  }

  // ── 3. Create or update the student ───────────────────────────────────────
  const categoryId = new Types.ObjectId(String(category._id));
  let student      = await userModel.findOne({ email: STUDENT_EMAIL.toLowerCase() });

  if (student) {
    console.log(`ℹ️   Student already exists — updating password + category access.`);
    await userModel.findByIdAndUpdate(student._id, {
      password:            hashedPassword,
      mustSetPassword:     false,
      isActive:            true,
      purchasedCategories: [categoryId], // installment 1 grants access
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
      purchasedCategories: [categoryId], // installment 1 grants access
    });
    console.log(`✅  Student created.`);
  }

  const userId = new Types.ObjectId(String(student!._id));

  // ── 4. Create Installment 1 payment record (if not already present) ────────
  const existingInstallment1 = await paymentModel.findOne({
    userId,
    categoryId,
    status:          PaymentStatus.COMPLETED,
    installmentNumber: 1,
  });

  if (existingInstallment1) {
    console.log(`ℹ️   Installment 1 payment record already exists — skipping.`);
  } else {
    const fakeReference = `SEED-INST1-${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 12)}`;
    await paymentModel.create({
      userId,
      categoryId,
      amount:            INSTALLMENT_AMOUNT,   // $50
      status:            PaymentStatus.COMPLETED,
      paystackReference: fakeReference,
      purchaseType:      PurchaseType.CATEGORY_ACCESS,
      isFullPayment:     false,
      isInstallment:     true,
      installmentNumber: 1,
      userTier:          USER_TIER,
      metadata: {
        seeded:    true,
        note:      'Installment 1 — created by arin-publishing-student-installment.seed.ts',
        createdAt: new Date().toISOString(),
      },
    });
    console.log(`✅  Installment 1 payment created: $${INSTALLMENT_AMOUNT} of $${STUDENT_FULL_PRICE} (${USER_TIER})`);
    console.log(`⚠️   Installment 2 ($${INSTALLMENT_AMOUNT}) is still owed — access is granted but balance remains`);
  }

  // ── 5. Verify saved password ───────────────────────────────────────────────
  const saved      = await userModel.findById(student!._id).select('+password');
  const loginWorks = await bcrypt.compare(STUDENT_PASSWORD, saved!.password);

  if (!loginWorks) {
    console.error('\n❌  Password saved to DB does NOT match — login will fail!');
    await app.close();
    process.exit(1);
  }

  // ── 6. Report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅  ARIN Publishing Academy student (installment) seeded successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email         : ${STUDENT_EMAIL}`);
  console.log(`🔐  Password      : ${STUDENT_PASSWORD}`);
  console.log(`📂  Category      : ${category.name}`);
  console.log(`🆔  User ID       : ${student!._id}`);
  console.log(`💳  Installment 1 : $${INSTALLMENT_AMOUNT} PAID   ✓  (access granted)`);
  console.log(`💳  Installment 2 : $${INSTALLMENT_AMOUNT} OWED   ✗`);
  console.log(`💰  Total student : $${STUDENT_FULL_PRICE}`);
  console.log(`✔️   Login test    : password verified against DB hash ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedStudentInstallment().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
