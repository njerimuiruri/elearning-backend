import {
  Controller,
  Get,
  Param,
  UseGuards,
  Query,
  Put,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  async getAllUsers(@Query('role') role?: string) {
    const filters = role ? { role } : {};
    return this.usersService.findAll(filters);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  async getUserStats() {
    return this.usersService.getUserStats();
  }

  @Get('instructors/pending')
  @Roles(UserRole.ADMIN)
  async getPendingInstructors() {
    return this.usersService.getPendingInstructors();
  }

  @Put(':id/approve-instructor')
  @Roles(UserRole.ADMIN)
  async approveInstructor(@Param('id') id: string) {
    return this.usersService.approveInstructor(id);
  }

  @Put(':id/reject-instructor')
  @Roles(UserRole.ADMIN)
  async rejectInstructor(@Param('id') id: string) {
    return this.usersService.rejectInstructor(id);
  }

  @Get('profile/current')
  async getCurrentUserProfile(@CurrentUser() user: any) {
    if (!user || !user._id) {
      return { error: 'Unauthorized' };
    }
    return this.usersService.findById(user._id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR, UserRole.STUDENT)
  async getUserById(@Param('id') id: string, @CurrentUser() user: any) {
    // Users can only view their own profile unless they're admin
    if (user.role !== UserRole.ADMIN && user._id.toString() !== id) {
      return { error: 'Unauthorized' };
    }
    return this.usersService.findById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateUser(@Param('id') id: string, @Body() updateData: any, @CurrentUser() user: any) {
    // Users can only update their own profile unless they're admin
    if (user._id.toString() !== id && user.role !== UserRole.ADMIN) {
      return { error: 'Unauthorized' };
    }
    return this.usersService.updateUser(id, updateData);
  }

  @Post(':id/upload-profile-photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    // Users can only upload their own profile photo unless they're admin
    if (user._id.toString() !== id && user.role !== UserRole.ADMIN) {
      return { error: 'Unauthorized' };
    }

    if (!file) {
      return { error: 'No file uploaded' };
    }

    return this.usersService.uploadProfilePhoto(id, file);
  }

}