import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserRole, InstructorStatus } from '../schemas/user.schema';
import { PasswordReset } from '../schemas/password-reset.schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterInstructorDto } from './dto/register-instructor.dto';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PasswordReset.name) private passwordResetModel: Model<PasswordReset>,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, role } = registerDto;

    // Check if user exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.userModel.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || UserRole.STUDENT,
      instructorStatus: role === UserRole.INSTRUCTOR ? InstructorStatus.PENDING : undefined,
    });

    // Send welcome email for self-registered students
    if (role !== UserRole.INSTRUCTOR) {
      try {
        await this.emailService.sendWelcomeEmail(email, firstName);
      } catch (error) {
        console.error('Failed to send welcome email:', error);
      }
    }

    // For students, generate token immediately
    if (role !== UserRole.INSTRUCTOR) {
      const token = this.generateToken(user);
      return {
        user: this.sanitizeUser(user),
        token,
        message: 'Registration successful',
      };
    }

    // For instructors, no token until approved
    return {
      user: this.sanitizeUser(user),
      message: 'Registration successful. Your account is pending approval.',
    };
  }

  async registerInstructor(registerInstructorDto: RegisterInstructorDto) {
    const { email, password, firstName, lastName, phoneNumber, institution, bio, profilePhotoUrl, cvUrl } = registerInstructorDto;

    // Check if user exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create instructor (pending approval)
    const instructor = await this.userModel.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.INSTRUCTOR,
      phoneNumber,
      institution,
      bio,
      profilePhotoUrl,
      cvUrl,
      instructorStatus: InstructorStatus.PENDING,
    });

    // Send notification to admin about pending instructor registration
    try {
      const adminUsers = await this.userModel.find({ role: UserRole.ADMIN });
      const adminEmails = adminUsers.map(admin => admin.email);
      
      // Also add the default admin email to ensure notifications are received
      const defaultAdminEmail = 'faith.muiruri@strathmore.edu';
      if (!adminEmails.includes(defaultAdminEmail)) {
        adminEmails.push(defaultAdminEmail);
      }
      
      for (const adminEmail of adminEmails) {
        await this.emailService.sendInstructorRegistrationNotificationToAdmin(
          adminEmail,
          `${firstName} ${lastName}`,
          email,
          institution,
          bio,
          instructor._id.toString(),
        );
      }
    } catch (error) {
      console.error('Failed to send admin notification:', error);
      // Don't fail the registration if email notification fails
    }

    return {
      user: this.sanitizeUser(instructor),
      message: 'Instructor registration submitted for approval. You will be notified once your account is approved.',
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
    }

    // Allow instructors to login regardless of approval status
    // The frontend will handle redirection based on instructorStatus

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = this.generateToken(user);

    return {
      user: this.sanitizeUser(user),
      token,
      message: 'Login successful',
    };
  }

  async validateUser(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      return null;
    }
    return user;
  }

  private generateToken(user: User) {
    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: User) {
    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  }

  // Password Reset Methods
  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      // Don't reveal if email exists for security
      return { success: true, message: 'If an account exists with this email, a reset link will be sent.' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Save reset token
    await this.passwordResetModel.create({
      userId: user._id,
      email,
      token: hashedToken,
    });

    // Send reset email
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password/${resetToken}`;
      await this.emailService.sendPasswordResetEmail(email, user.firstName, resetUrl);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }

    return {
      success: true,
      message: 'If an account exists with this email, a reset link will be sent.',
    };
  }

  async resetPassword(token: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Hash token to compare
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find reset record
    const resetRecord = await this.passwordResetModel.findOne({
      token: hashedToken,
      createdAt: { $gt: new Date(Date.now() - 3600000) }, // Within 1 hour
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(resetRecord.userId, {
      password: hashedPassword,
    });

    // Delete reset token
    await this.passwordResetModel.deleteOne({ _id: resetRecord._id });

    return { success: true, message: 'Password reset successful' };
  }

  async setInitialPassword(token: string, password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await this.passwordResetModel.findOne({
      token: hashedToken,
      createdAt: { $gt: new Date(Date.now() - 24 * 3600000) }, // Within 24 hours
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired setup link');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await this.userModel.findByIdAndUpdate(resetRecord.userId, {
      password: hashedPassword,
    });

    await this.passwordResetModel.deleteOne({ _id: resetRecord._id });

    return { success: true, message: 'Password set successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New passwords do not match');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
    });

    return { success: true, message: 'Password changed successfully' };
  }

}
