import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Get,
  UseGuards,
  Put,
  UploadedFile,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterInstructorDto } from './dto/register-instructor.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { User } from '../schemas/user.schema';
import * as path from 'path';
import * as fs from 'fs';

// Ensure uploads directory exists
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

@Controller('api/auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('google')
  @ApiOperation({ summary: 'Login or register with Google for students and instructors' })
  @ApiResponse({ status: 200, description: 'Google login successful, returns JWT token' })
  async googleLogin(@Body() body: GoogleLoginDto) {
    return this.authService.googleLogin(body);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  async logout(@CurrentUser() user: User) {
    // Update last logout time
    await this.usersService.updateUser(user._id.toString(), {
      lastLogout: new Date(),
    } as any);

    return {
      message: 'Logged out successfully',
      success: true,
    };
  }

  @Post('register')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'profileImage', maxCount: 1 },
        { name: 'cvFile', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: uploadsDir,
          filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = path.extname(file.originalname);
            cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
          },
        }),
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
        fileFilter: (req, file, cb) => {
          if (file.fieldname === 'profileImage') {
            if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
              return cb(
                new BadRequestException('Only image files are allowed for profile picture'),
                false,
              );
            }
          } else if (file.fieldname === 'cvFile') {
            if (
              !file.mimetype.match(
                /\/(pdf|msword|vnd.openxmlformats-officedocument.wordprocessingml.document)$/,
              )
            ) {
              return cb(
                new BadRequestException('Only PDF, DOC, or DOCX files are allowed for CV'),
                false,
              );
            }
          }
          cb(null, true);
        },
      },
    ),
  )
  async register(
    @Body() body: any,
    @UploadedFiles()
    files: {
      profileImage?: Express.Multer.File[];
      cvFile?: Express.Multer.File[];
    },
  ) {
    const { role } = body;

    if (role === 'instructor') {
      const instructorDto: RegisterInstructorDto = {
        ...body,
        profilePhotoUrl: files?.profileImage?.[0]?.path,
        cvUrl: files?.cvFile?.[0]?.path,
      };

      if (!instructorDto.cvUrl) {
        throw new BadRequestException('CV is required for instructor registration');
      }

      return this.authService.registerInstructor(instructorDto);
    }

    const registerDto: RegisterDto = body;
    return this.authService.register(registerDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User) {
    return {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        userType: user.userType,
        profilePhotoUrl: user.profilePhotoUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        country: user.country,
        totalPoints: user.totalPoints,
        currentStreakDays: user.currentStreakDays,
        longestStreakDays: user.longestStreakDays,
        emailVerified: user.emailVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    };
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() updateData: Partial<User>,
  ) {
    // Don't allow updating sensitive fields
    const allowedFields = [
      'firstName',
      'lastName',
      'bio',
      'phoneNumber',
      'country',
      'institution',
    ];

    const filteredData = Object.keys(updateData)
      .filter((key) => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {});

    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      filteredData,
    );

    return {
      user: updatedUser,
      message: 'Profile updated successfully',
    };
  }

  @Post('upload-photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('profileImage', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, `profile-${uniqueSuffix}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadProfilePhoto(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Delete old profile photo if exists
    if (user.profilePhotoUrl && fs.existsSync(user.profilePhotoUrl)) {
      try {
        fs.unlinkSync(user.profilePhotoUrl);
      } catch (error) {
        console.error('Error deleting old profile photo:', error);
      }
    }

    // Update user profile photo
    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      { profilePhotoUrl: file.path } as any,
    );

    return {
      user: updatedUser,
      message: 'Profile photo uploaded successfully',
    };
  }

  @Post('remove-photo')
  @UseGuards(JwtAuthGuard)
  async removeProfilePhoto(@CurrentUser() user: User) {
    // Delete profile photo file if exists
    if (user.profilePhotoUrl && fs.existsSync(user.profilePhotoUrl)) {
      try {
        fs.unlinkSync(user.profilePhotoUrl);
      } catch (error) {
        console.error('Error deleting profile photo:', error);
      }
    }

    // Update user to remove profile photo
    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      { profilePhotoUrl: null } as any,
    );

    return {
      user: updatedUser,
      message: 'Profile photo removed successfully',
    };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verifyToken(@CurrentUser() user: User) {
    return {
      valid: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.resetPassword(token, newPassword, confirmPassword);
  }

  @Post('set-initial-password')
  async setInitialPassword(
    @Body('token') token: string,
    @Body('password') password: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.setInitialPassword(token, password, confirmPassword);
  }

  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: User,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.changePassword(user._id.toString(), currentPassword, newPassword, confirmPassword);
  }
}