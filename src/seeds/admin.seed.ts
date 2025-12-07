import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../schemas/user.schema';

async function seedAdmin() {
  const app = await NestFactory.create(AppModule);
  const userModel = app.get('UserModel') || app.get('UserModelToken');
  
  // If model not found via injection token, get it from module
  let model: Model<User>;
  try {
    model = app.get('UserModel');
  } catch {
    // Use connection to get model
    const connection = app.get('DEFAULT_MONGOOSE_CONNECTION');
    model = connection.model('User');
  }

  try {
    // Admin credentials
    const adminEmail = 'admin@elearning.com';
    const adminPassword = 'Admin@123456';
    const adminFirstName = 'Admin';
    const adminLastName = 'User';

    // Check if admin already exists
    const existingAdmin = await model.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('✓ Admin user already exists:', adminEmail);
      await app.close();
      return;
    }

    // Hash password using bcrypt
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    const adminUser = await model.create({
      firstName: adminFirstName,
      lastName: adminLastName,
      email: adminEmail,
      password: hashedPassword,
      role: UserRole.ADMIN,
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('✓ Admin user created successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:', adminEmail);
    console.log('🔐 Password:', adminPassword);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  Please change this password after first login');
    console.log('User ID:', adminUser._id);
  } catch (error) {
    console.error('❌ Error seeding admin user:', error.message);
  } finally {
    await app.close();
  }
}

// Run the seed function
seedAdmin().catch(console.error);

