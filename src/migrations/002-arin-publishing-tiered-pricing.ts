import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Category } from '../schemas/category.schema';

async function migrateArinPublishingAcademy() {
  const app = await NestFactory.create(AppModule);

  try {
    const categoryModel = app.get(getModelToken(Category.name));

    const result = await categoryModel.findOneAndUpdate(
      { name: 'Arin Publishing Academy' },
      {
        $set: {
          accessType: 'paid',
          isPaid: true,
          paymentRequiredForNonEligible: true,
          hasTieredPricing: true,
          studentPrice: 100,
          nonStudentPrice: 200,
          price: 200, // fallback price (non-student)
        },
      },
      { new: true },
    );

    if (result) {
      console.log('✓ Arin Publishing Academy updated with tiered pricing:');
      console.log(`  Student price: $${result.studentPrice}`);
      console.log(`  Non-student price: $${result.nonStudentPrice}`);
    } else {
      console.warn('⚠ Arin Publishing Academy category not found');
    }
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
  } finally {
    await app.close();
  }
}

migrateArinPublishingAcademy();
