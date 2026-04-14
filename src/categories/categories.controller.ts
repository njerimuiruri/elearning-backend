import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CategoryService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('api/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  async getAllCategories() {
    const categories = await this.categoryService.findAll();
    return {
      success: true,
      data: categories,
    };
  }

  @Get(':id')
  async getCategoryById(@Param('id') id: string) {
    const category = await this.categoryService.findById(id);
    return {
      success: true,
      data: category,
    };
  }

  /**
   * Get all published modules for a specific category
   * GET /api/categories/:id/modules
   */
  @Get(':id/modules')
  async getModulesByCategory(
    @Param('id') categoryId: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.categoryService.getModulesByCategory(
      categoryId,
      {
        level,
        search,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 12,
      },
    );

    return {
      success: true,
      data: result.modules,
      total: result.total,
      pages: result.pages,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 12,
    };
  }

  /**
   * Get category details with all its modules
   * GET /api/categories/:id/with-modules
   */
  @Get(':id/with-modules')
  async getCategoryWithModules(
    @Param('id') categoryId: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.categoryService.getCategoryWithModules(
      categoryId,
      {
        level,
        search,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 12,
      },
    );

    return {
      success: true,
      category: result.category,
      modules: result.modules,
      total: result.total,
      pages: result.pages,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 12,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createCategory(@Body() createCategoryDto: CreateCategoryDto) {
    const category = await this.categoryService.create(createCategoryDto);
    return {
      success: true,
      data: category,
      message: 'Category created successfully',
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    const category = await this.categoryService.update(id, updateCategoryDto);
    return {
      success: true,
      data: category,
      message: 'Category updated successfully',
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteCategory(@Param('id') id: string) {
    const category = await this.categoryService.softDelete(id);
    return {
      success: true,
      data: category,
      message: 'Category deleted successfully',
    };
  }
}
