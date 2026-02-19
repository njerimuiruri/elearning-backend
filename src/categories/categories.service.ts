import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category } from '../schemas/category.schema';
import { User } from '../schemas/user.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async create(createCategoryDto: CreateCategoryDto): Promise<Category> {
    const createdCategory = new this.categoryModel(createCategoryDto);
    return createdCategory.save();
  }

  async findAll(): Promise<Category[]> {
    return this.categoryModel.find({ isActive: true }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<Category | null> {
    return this.categoryModel.findById(id).exec();
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto): Promise<Category | null> {
    return this.categoryModel
      .findByIdAndUpdate(id, updateCategoryDto, { new: true })
      .exec();
  }

  async delete(id: string): Promise<Category | null> {
    return this.categoryModel.findByIdAndDelete(id).exec();
  }

  async softDelete(id: string): Promise<Category | null> {
    return this.categoryModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .exec();
  }

  /**
   * Validates if a user can access a specific category
   */
  async checkAccess(categoryId: string, user: any): Promise<{ 
    allowed: boolean; 
    reason?: 'payment_required' | 'restricted_role' | 'login_required';
    price?: number;
  }> {
    const category = await this.categoryModel.findById(categoryId);
    if (!category) throw new NotFoundException('Category not found');

    // 1. Admins always have access
    if (user?.role === 'admin') return { allowed: true };

    // 2. Check Access Type
    switch (category.accessType) {
      case 'free':
        return { allowed: true };

      case 'restricted':
        // Rule: "AI for Climate Resilience" is free ONLY for Fellows
        if (category.allowedRoles.includes(user?.role)) {
          return { allowed: true };
        }
        
        // Rule: Non-fellows must pay (if allowed)
        if (category.paymentRequiredForNonEligible) {
          const hasPaid = await this.checkPaymentStatus(user?._id, categoryId);
          return hasPaid 
            ? { allowed: true }
            : { allowed: false, reason: 'payment_required', price: category.price };
        }
        
        return { allowed: false, reason: 'restricted_role' };

      case 'paid':
        const hasPaid = await this.checkPaymentStatus(user?._id, categoryId);
        return hasPaid 
          ? { allowed: true } 
          : { allowed: false, reason: 'payment_required', price: category.price };

      default:
        return { allowed: false, reason: 'restricted_role' };
    }
  }

  /**
   * Check if a user has paid for a category
   * Checks both the user's purchasedCategories field and fellow assignedCategories
   */
  private async checkPaymentStatus(userId: string, categoryId: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      return false;
    }

    // Check if user has purchased this category
    if (user.purchasedCategories) {
      const hasPurchased = user.purchasedCategories.some(
        (catId) => catId.toString() === categoryId.toString(),
      );
      if (hasPurchased) {
        return true;
      }
    }

    // Check if user is a fellow with this category assigned
    if (user.fellowData?.assignedCategories) {
      const isAssigned = user.fellowData.assignedCategories.some(
        (catId) => catId.toString() === categoryId.toString(),
      );
      if (isAssigned) {
        return true;
      }
    }

    return false;
  }
}
