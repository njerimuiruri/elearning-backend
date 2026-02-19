import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { Payment, PaymentSchema } from './entities/payment.entity';
import { Course, CourseSchema } from '../schemas/course.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import {
  Module as ModuleSchema,
  ModuleSchema as ModuleSchemaDefinition,
} from '../schemas/module.schema';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
      { name: ModuleSchema.name, schema: ModuleSchemaDefinition },
    ]),
    CategoriesModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaystackService],
  exports: [PaymentsService, PaystackService],
})
export class PaymentsModule {}
