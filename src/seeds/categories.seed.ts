import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Category } from '../schemas/category.schema';

async function seedCategories() {
  const app = await NestFactory.create(AppModule);
  
  try {
    const categoryModel = app.get(getModelToken(Category.name));

    // Check if categories already exist
    const existingCategories = await categoryModel.find();
    if (existingCategories.length > 0) {
      console.log('✓ Categories already exist. Total:', existingCategories.length);
      await app.close();
      return;
    }

    const defaultCategories = [
      {
        name: 'Arin Publishing Academy',
        description: 'Comprehensive publishing and academic courses',
        isActive: true,
      },
      {
        name: 'AI for Climate Resilience',
        description: 'Artificial Intelligence applied to climate adaptation',
        isActive: true,
      },
      {
        name: 'Just Energy Transition Summer School',
        description: 'Energy transition and sustainability programs',
        isActive: true,
      },
      {
        name: 'Climate Adaptation Finance Professional Training',
        description: 'Professional training in climate finance and adaptation',
        isActive: true,
      },
    ];

    const createdCategories = await categoryModel.insertMany(defaultCategories);
    console.log('✓ Categories seeded successfully:', createdCategories.length);

  } catch (error) {
    console.error('✗ Error seeding categories:', error.message);
  } finally {
    await app.close();
  }
}

seedCategories();
