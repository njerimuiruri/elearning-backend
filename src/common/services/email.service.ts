import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    // Configure email transporter
    // For production, use real SMTP service (Gmail, SendGrid, etc.)
    // For development, you can use Mailtrap or similar
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST') || 'smtp.mailtrap.io',
      port: parseInt(this.configService.get('SMTP_PORT') || '2525'),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  async sendInstructorApprovalEmail(email: string, firstName: string, isApproved: boolean) {
    const subject = isApproved ? 'Your Instructor Application Approved' : 'Your Instructor Application Rejected';

    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/auth/login`;

    const htmlContent = isApproved
      ? `
        <h2>Welcome to E-Learning Platform!</h2>
        <p>Dear ${firstName},</p>
        <p>Great news! Your instructor application has been <strong>APPROVED</strong> by our admin team.</p>
        <p>You can now log in to your instructor account and start creating courses.</p>
        <p><strong>Login credentials:</strong></p>
        <ul>
          <li>Email: ${email}</li>
          <li>Password: (Use the password you created during registration)</li>
        </ul>
        <p>
          <a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Click here to log in</a>
        </p>
        <p>After logging in, you will be redirected to your instructor dashboard.</p>
        <p>If you have any questions, please contact our support team.</p>
        <p>Best regards,<br/>E-Learning Platform Team</p>
      `
      : `
        <h2>Instructor Application Decision</h2>
        <p>Dear ${firstName},</p>
        <p>Unfortunately, your instructor application has been <strong>REJECTED</strong>.</p>
        <p>Your application did not meet our requirements at this time. You may reapply in the future with updated information.</p>
        <p>If you believe this is an error or need more information, please contact our support team.</p>
        <p>Best regards,<br/>E-Learning Platform Team</p>
      `;

    const plainTextContent = isApproved
      ? `Welcome to E-Learning Platform!\n\nDear ${firstName},\n\nGreat news! Your instructor application has been APPROVED by our admin team.\n\nYou can now log in to your instructor account and start creating courses.\n\nLogin credentials:\nEmail: ${email}\nPassword: (Use the password you created during registration)\n\nLogin here: ${loginUrl}\n\nAfter logging in, you will be redirected to your instructor dashboard.\n\nIf you have any questions, please contact our support team.\n\nBest regards,\nE-Learning Platform Team`
      : `Instructor Application Decision\n\nDear ${firstName},\n\nUnfortunately, your instructor application has been REJECTED.\n\nYour application did not meet our requirements at this time. You may reapply in the future with updated information.\n\nIf you believe this is an error or need more information, please contact our support team.\n\nBest regards,\nE-Learning Platform Team`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendInstructorRegistrationNotificationToAdmin(
    adminEmail: string,
    instructorName: string,
    instructorEmail: string,
    institution: string,
    bio: string,
    userId: string,
  ) {
    const subject = 'New Instructor Registration Pending Approval';

    const htmlContent = `
      <h2>New Instructor Registration</h2>
      <p>A new instructor has registered and is awaiting your approval.</p>
      <p><strong>Instructor Details:</strong></p>
      <ul>
        <li><strong>Name:</strong> ${instructorName}</li>
        <li><strong>Email:</strong> ${instructorEmail}</li>
        <li><strong>Institution:</strong> ${institution || 'Not provided'}</li>
        <li><strong>Bio:</strong> ${bio || 'Not provided'}</li>
        <li><strong>User ID:</strong> ${userId}</li>
      </ul>
      <p>Please log in to the admin dashboard to review and approve or reject this application.</p>
      <p>Best regards,<br/>E-Learning Platform System</p>
    `;

    const plainTextContent = `
New Instructor Registration

A new instructor has registered and is awaiting your approval.

Instructor Details:
Name: ${instructorName}
Email: ${instructorEmail}
Institution: ${institution || 'Not provided'}
Bio: ${bio || 'Not provided'}
User ID: ${userId}

Please log in to the admin dashboard to review and approve or reject this application.

Best regards,
E-Learning Platform System
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: adminEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Notification sent to admin` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendStudentRegistrationEmail(email: string, firstName: string, temporaryPassword: string) {
    const subject = 'Welcome to Arin Publishing Academy - Your Account Has Been Created';
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/auth/login`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">Welcome to Arin Publishing Academy!</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        <p>Your account has been successfully created by the administrator. We're excited to have you on board at <strong>Arin Publishing Academy</strong>!</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <h3 style="color: #16a34a; margin-top: 0;">Your Login Credentials</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> <code style="background-color: #e8e8e8; padding: 5px 10px; border-radius: 3px; font-family: monospace;">${temporaryPassword}</code></p>
        </div>
        
        <h3 style="color: #16a34a;">Important Security Note</h3>
        <p>For your account security, you will be required to create a new password on your first login. This ensures your account remains protected.</p>
        
        <h3 style="color: #16a34a;">Next Steps</h3>
        <ol>
          <li>Visit our platform at: <a href="${loginUrl}" style="color: #16a34a; text-decoration: none;"><strong>${loginUrl}</strong></a></li>
          <li>Log in with your email and temporary password</li>
          <li>Create a new secure password when prompted</li>
          <li>Start exploring our courses and learning materials</li>
        </ol>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="display: inline-block; background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Login to Your Account</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 14px; color: #666;">If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
        <p style="font-size: 14px;">Best regards,<br/><strong>Arin Publishing Academy Team</strong></p>
      </div>
    `;

    const plainTextContent = `
Welcome to Arin Publishing Academy!

Dear ${firstName},

Your account has been successfully created by the administrator. We're excited to have you on board!

Your Login Credentials:
Email: ${email}
Temporary Password: ${temporaryPassword}

Important Security Note:
For your account security, you will be required to create a new password on your first login.

Next Steps:
1. Visit our platform: ${loginUrl}
2. Log in with your email and temporary password
3. Create a new secure password when prompted
4. Start exploring our courses and learning materials

If you have any questions or need assistance, please don't hesitate to contact our support team.

Best regards,
Arin Publishing Academy Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Registration email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendWelcomeEmail(email: string, firstName: string) {
    const subject = 'Welcome to Arin Publishing Academy!';
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const coursesUrl = `${frontendUrl}/student/courses`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">Welcome to Arin Publishing Academy!</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        <p>Thank you for joining <strong>Arin Publishing Academy</strong>! We're thrilled to have you as part of our learning community.</p>
        
        <h3 style="color: #16a34a;">What Awaits You</h3>
        <ul style="font-size: 16px;">
          <li>📚 Access to diverse, industry-relevant courses</li>
          <li>🏆 Earn certificates upon course completion</li>
          <li>💬 Interact with instructors and fellow learners</li>
          <li>📊 Track your progress and achievements</li>
          <li>🚀 Advance your skills and career prospects</li>
        </ul>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${coursesUrl}" style="display: inline-block; background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Explore Courses</a>
        </div>
        
        <h3 style="color: #16a34a;">Getting Started</h3>
        <p>Your account is now active. You can log in immediately and start exploring our course catalog. Choose courses that match your interests and learning goals.</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <p><strong>Pro Tip:</strong> Complete courses at your own pace and earn certificates to showcase your achievements!</p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 14px; color: #666;">Questions or need help? Our support team is here to assist you. Feel free to reach out anytime.</p>
        <p style="font-size: 14px;">Happy learning!<br/><strong>Arin Publishing Academy Team</strong></p>
      </div>
    `;

    const plainTextContent = `
Welcome to Arin Publishing Academy!

Dear ${firstName},

Thank you for joining Arin Publishing Academy! We're thrilled to have you as part of our learning community.

What Awaits You:
- Access to diverse, industry-relevant courses
- Earn certificates upon course completion
- Interact with instructors and fellow learners
- Track your progress and achievements
- Advance your skills and career prospects

Getting Started:
Your account is now active. You can log in immediately and start exploring our course catalog. Choose courses that match your interests and learning goals.

Pro Tip: Complete courses at your own pace and earn certificates to showcase your achievements!

Explore Courses: ${coursesUrl}

Questions or need help? Our support team is here to assist you. Feel free to reach out anytime.

Happy learning!
Arin Publishing Academy Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Welcome email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(email: string, firstName: string, resetUrl: string) {
    const subject = 'Reset Your E-Learning Platform Password';

    const htmlContent = `
      <h2>Password Reset Request</h2>
      <p>Dear ${firstName},</p>
      <p>We received a request to reset your password for your E-Learning Platform account.</p>
      <p><strong>To reset your password, click the link below:</strong></p>
      <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
      <p>This link will expire in 1 hour.</p>
      <p><strong>If you did not request a password reset,</strong> please ignore this email or contact our support team immediately.</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Password Reset Request

Dear ${firstName},

We received a request to reset your password for your E-Learning Platform account.

To reset your password, visit this link:
${resetUrl}

This link will expire in 1 hour.

If you did not request a password reset, please ignore this email or contact our support team immediately.

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Reset email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseEnrollmentEmail(email: string, studentName: string, courseName: string) {
    const subject = `Successfully Enrolled in ${courseName}`;

    const htmlContent = `
      <h2>Course Enrollment Confirmation</h2>
      <p>Dear ${studentName},</p>
      <p>You have successfully enrolled in <strong>${courseName}</strong>.</p>
      <p>You can now access the course materials and begin learning. Log in to your account to get started.</p>
      <p><strong>Course Features:</strong></p>
      <ul>
        <li>Structured course modules and lessons</li>
        <li>Assessments and quizzes</li>
        <li>Progress tracking</li>
        <li>Interactive Q&A with instructors</li>
        <li>Certificates upon completion</li>
      </ul>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Course Enrollment Confirmation

Dear ${studentName},

You have successfully enrolled in ${courseName}.

You can now access the course materials and begin learning. Log in to your account to get started.

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Enrollment email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCertificateEmail(email: string, studentName: string, courseName: string, certificateUrl: string) {
    const subject = `Certificate Earned: ${courseName}`;

    const htmlContent = `
      <h2>Congratulations on Your Certificate!</h2>
      <p>Dear ${studentName},</p>
      <p>Congratulations! You have successfully completed <strong>${courseName}</strong> and earned your certificate.</p>
      <p>Your certificate is now available and can be downloaded or shared:</p>
      <p><a href="${certificateUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Certificate</a></p>
      <p>Your achievement is a testament to your dedication and hard work. Keep learning and growing!</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Congratulations on Your Certificate!

Dear ${studentName},

Congratulations! You have successfully completed ${courseName} and earned your certificate.

Your certificate is now available and can be downloaded or shared:
${certificateUrl}

Your achievement is a testament to your dedication and hard work. Keep learning and growing!

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Certificate email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseReminderEmail(email: string, studentName: string, courseName: string, progress: number) {
    const subject = `Reminder: Continue Learning ${courseName}`;

    const htmlContent = `
      <h2>Course Reminder</h2>
      <p>Dear ${studentName},</p>
      <p>We noticed you haven't completed <strong>${courseName}</strong> yet.</p>
      <p><strong>Your Progress:</strong> ${progress}%</p>
      <p>Continue where you left off and earn your certificate. You're almost there!</p>
      <p>Log in to your account to resume learning.</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Course Reminder

Dear ${studentName},

We noticed you haven't completed ${courseName} yet.

Your Progress: ${progress}%

Continue where you left off and earn your certificate. You're almost there!

Log in to your account to resume learning.

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Reminder email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseApprovedEmail(email: string, instructorName: string, courseName: string) {
    const subject = `Your Course Has Been Approved: ${courseName}`;

    const htmlContent = `
      <h2>Course Approval Notification</h2>
      <p>Dear ${instructorName},</p>
      <p>Great news! Your course <strong>${courseName}</strong> has been approved by the admin team.</p>
      <p>Your course is now live and students can start enrolling.</p>
      <p>Log in to your instructor dashboard to monitor student progress and respond to questions.</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Course Approval Notification

Dear ${instructorName},

Great news! Your course ${courseName} has been approved by the admin team.

Your course is now live and students can start enrolling.

Log in to your instructor dashboard to monitor student progress and respond to questions.

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Approval email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseRejectedEmail(email: string, instructorName: string, courseName: string, reason: string) {
    const subject = `Course Revision Required: ${courseName}`;

    const htmlContent = `
      <h2>Course Revision Required</h2>
      <p>Dear ${instructorName},</p>
      <p>Your course <strong>${courseName}</strong> requires revisions before approval.</p>
      <p><strong>Feedback:</strong></p>
      <p>${reason}</p>
      <p>Please review the feedback, make the necessary changes, and resubmit your course for approval.</p>
      <p>Log in to your instructor dashboard to update your course.</p>
      <p>Best regards,<br/>E-Learning Platform Team</p>
    `;

    const plainTextContent = `
Course Revision Required

Dear ${instructorName},

Your course ${courseName} requires revisions before approval.

Feedback:
${reason}

Please review the feedback, make the necessary changes, and resubmit your course for approval.

Log in to your instructor dashboard to update your course.

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Rejection email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}
