import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoryService } from './categories.service';
import { CategoryController } from './categories.controller';
import { CategoryAccessControlService } from './access-control.service';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Course, CourseSchema } from '../schemas/course.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
      { name: Course.name, schema: CourseSchema },
    ]),
  ],
  providers: [CategoryService, CategoryAccessControlService],
  controllers: [CategoryController],
  exports: [CategoryService, CategoryAccessControlService],
})
export class CategoriesModule {}
