/**
 * Seed script — creates a test student and marks the first 6 published modules
 * as completed so the student can access the capstone page.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/seed-test-student.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

const EMAIL    = 'teststudent@arin.test';
const PASSWORD = 'Test@1234';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const UserModel             = app.get<Model<any>>(getModelToken('User'));
  const ModuleModel           = app.get<Model<any>>(getModelToken('Module'));
  const ModuleEnrollmentModel = app.get<Model<any>>(getModelToken('ModuleEnrollment'));
  const CategoryModel         = app.get<Model<any>>(getModelToken('Category'));

  // ── 0. Find the AI for Climate Resilience category ───────────────────────
  const category = await CategoryModel.findOne({
    name: { $regex: 'AI for Climate Resilience', $options: 'i' },
  }).lean() as any;

  if (!category) {
    console.warn('⚠️  Could not find "AI for Climate Resilience" category — fellow access will be missing');
  } else {
    console.log(`✅ Found category: ${category.name}`);
  }

  // ── 1. Create or reuse the test student ──────────────────────────────────
  let student = await UserModel.findOne({ email: EMAIL });

  if (!student) {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    student = await UserModel.create({
      firstName:     'Test',
      lastName:      'Student',
      email:         EMAIL,
      password:      hashed,
      role:          'student',
      userType:      'fellow',
      isActive:      true,
      emailVerified: true,
      fellowData: category ? {
        fellowId:         `FELLOW-TEST-001`,
        cohort:           new Date().getFullYear().toString(),
        deadline:         new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        requiredCourses:  [],
        fellowshipStatus: 'active',
        assignedCategories: [new Types.ObjectId(category._id)],
        region: null,
        track:  null,
      } : null,
    });
    console.log('✅ Student created');
  } else {
    // Patch existing student with correct fellow data if category found
    if (category) {
      await UserModel.updateOne(
        { _id: student._id },
        {
          $set: {
            userType:  'fellow',
            fellowData: {
              fellowId:           student.fellowData?.fellowId || 'FELLOW-TEST-001',
              cohort:             new Date().getFullYear().toString(),
              deadline:           new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
              requiredCourses:    [],
              fellowshipStatus:   'active',
              assignedCategories: [new Types.ObjectId(category._id)],
              region: null,
              track:  null,
            },
          },
        },
      );
      console.log('✅ Student fellow data updated');
    } else {
      console.log('ℹ️  Student already exists — reusing');
    }
  }

  // ── 2. Find all published modules ────────────────────────────────────────
  const modules = await ModuleModel
    .find({ status: 'published' })
    .sort({ createdAt: 1 })
    .lean();

  if (modules.length === 0) {
    console.error('❌ No published modules found. Publish at least one module first.');
    await app.close();
    return;
  }

  console.log(`📚 Found ${modules.length} published module(s) — marking all as completed`);

  // ── 3. Upsert a completed enrollment for each module ────────────────────
  for (const mod of modules) {
    await ModuleEnrollmentModel.findOneAndUpdate(
      { studentId: student._id, moduleId: mod._id },
      {
        $set: {
          studentId:             student._id,
          moduleEmail:           EMAIL,
          moduleId:              mod._id,
          isCompleted:           true,
          completedAt:           new Date(),
          progress:              100,
          finalAssessmentPassed: true,
          finalAssessmentScore:  85,
          enrolledAt:            new Date(),
        },
      },
      { upsert: true, new: true },
    );
    console.log(`  ✔  Enrolled & completed: ${mod.title}`);
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  console.log('Test student ready:');
  console.log(`  Email   : ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log('─────────────────────────────────────────\n');

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
