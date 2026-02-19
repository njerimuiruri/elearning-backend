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

  async sendMessageNotification(toEmail: string, subject: string, htmlContent: string, plainTextContent: string) {
    if (!toEmail) {
      return { success: false, message: 'No recipient email provided' };
    }

    const attempts = 3;
    let lastError: any = null;

    for (let i = 1; i <= attempts; i++) {
      try {
        await this.transporter.sendMail({
          from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
          to: toEmail,
          subject,
          html: htmlContent,
          text: plainTextContent,
        });

        return { success: true, message: `Message email sent to ${toEmail}` };
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${i} failed sending message notification email:`, error);
        if (i < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }

    return { success: false, message: lastError?.message || 'Failed to send message email' };
  }

  async sendInstructorApprovalEmail(email: string, firstName: string, isApproved: boolean) {
    const subject = isApproved ? 'Your Instructor Application Approved' : 'Your Instructor Application Rejected';

    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/login`;

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
    const loginUrl = `${frontendUrl}/login`;

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

  async sendInstructorRegistrationEmail(email: string, firstName: string, temporaryPassword: string) {
    const subject = 'Welcome to Arin Publishing Academy - Your Instructor Account Has Been Created';
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/login`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #1d4ed8; border-bottom: 3px solid #1d4ed8; padding-bottom: 10px;">Welcome to Arin Publishing Academy!</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        <p>Your instructor account has been successfully created by the administrator. We're excited to have you as part of our teaching team at <strong>Arin Publishing Academy</strong>!</p>
        
        <div style="background-color: #eff6ff; border-left: 4px solid #1d4ed8; padding: 15px; margin: 20px 0;">
          <h3 style="color: #1d4ed8; margin-top: 0;">Your Login Credentials</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Role:</strong> Instructor</p>
          <p><strong>Temporary Password:</strong> <code style="background-color: #e8e8e8; padding: 5px 10px; border-radius: 3px; font-family: monospace;">${temporaryPassword}</code></p>
        </div>
        
        <h3 style="color: #1d4ed8;">Important Security Note</h3>
        <p>For your account security, you will be required to create a new password on your first login. This ensures your account remains protected.</p>
        
        <h3 style="color: #1d4ed8;">Next Steps</h3>
        <ol>
          <li>Visit our platform at: <a href="${loginUrl}" style="color: #1d4ed8; text-decoration: none;"><strong>${loginUrl}</strong></a></li>
          <li>Log in with your email and temporary password</li>
          <li>Create a new secure password when prompted</li>
          <li>Start creating and managing your courses</li>
          <li>Engage with students and build your teaching community</li>
        </ol>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Login to Your Instructor Dashboard</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 14px; color: #666;">If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
        <p style="font-size: 14px;">Best regards,<br/><strong>Arin Publishing Academy Team</strong></p>
      </div>
    `;

    const plainTextContent = `
Welcome to Arin Publishing Academy!

Dear ${firstName},

Your instructor account has been successfully created by the administrator. We're excited to have you as part of our teaching team!

Your Login Credentials:
Email: ${email}
Role: Instructor
Temporary Password: ${temporaryPassword}

Important Security Note:
For your account security, you will be required to create a new password on your first login.

Next Steps:
1. Visit our platform: ${loginUrl}
2. Log in with your email and temporary password
3. Create a new secure password when prompted
4. Start creating and managing your courses
5. Engage with students and build your teaching community

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

  // Course-related Emails
  async sendCourseSubmissionNotificationToAdmin(
    adminEmail: string,
    instructorName: string,
    instructorEmail: string,
    courseTitle: string,
    courseCategory: string,
    courseDescription: string,
    moduleCount: number,
    courseId: string,
  ) {
    const subject = `New Course Submission - ${courseTitle}`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const adminDashboardUrl = `${frontendUrl}/admin/courses`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">New Course Submission</h2>
        <p>A new course has been submitted for your review.</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <h3 style="color: #16a34a; margin-top: 0;">Course Details</h3>
          <p><strong>Course Title:</strong> ${courseTitle}</p>
          <p><strong>Instructor:</strong> ${instructorName} (${instructorEmail})</p>
          <p><strong>Category:</strong> ${courseCategory}</p>
          <p><strong>Description:</strong> ${courseDescription}</p>
          <p><strong>Number of Modules:</strong> ${moduleCount}</p>
          <p><strong>Course ID:</strong> ${courseId}</p>
        </div>
        
        <p style="margin-top: 20px;">
          <a href="${adminDashboardUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Review in Admin Dashboard</a>
        </p>
        
        <p>Please review and approve or reject this course submission.</p>
        <p>Best regards,<br/>E-Learning Platform System</p>
      </div>
    `;

    const plainTextContent = `
New Course Submission

A new course has been submitted for your review.

Course Details:
Title: ${courseTitle}
Instructor: ${instructorName} (${instructorEmail})
Category: ${courseCategory}
Description: ${courseDescription}
Number of Modules: ${moduleCount}
Course ID: ${courseId}

Review Link: ${adminDashboardUrl}

Please review and approve or reject this course submission.

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
      return { success: true, message: `Course submission notification sent to admin` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseApprovalEmailToInstructor(
    email: string,
    firstName: string,
    courseTitle: string,
  ) {
    const subject = `Your Course Has Been Approved! 🎉`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const coursePageUrl = `${frontendUrl}/courses`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">Course Approved! 🎉</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        
        <p>Congratulations! Your course <strong>"${courseTitle}"</strong> has been <strong>APPROVED</strong> and is now published on our platform.</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <h3 style="color: #16a34a; margin-top: 0;">What's Next?</h3>
          <ul>
            <li>Your course is now visible on the platform homepage</li>
            <li>Students can discover and enroll in your course</li>
            <li>You can track student progress and engagement</li>
            <li>Monitor student completions and assessments</li>
          </ul>
        </div>
        
        <p>
          <a href="${coursePageUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">View Your Course</a>
        </p>
        
        <p>Thank you for creating quality educational content!</p>
        <p>Best regards,<br/>E-Learning Platform Team</p>
      </div>
    `;

    const plainTextContent = `
Course Approved! 🎉

Dear ${firstName},

Congratulations! Your course "${courseTitle}" has been APPROVED and is now published on our platform.

What's Next?
- Your course is now visible on the platform homepage
- Students can discover and enroll in your course
- You can track student progress and engagement
- Monitor student completions and assessments

View Your Course: ${coursePageUrl}

Thank you for creating quality educational content!

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
      return { success: true, message: `Course approval email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendCourseRejectionEmailToInstructor(
    email: string,
    firstName: string,
    courseTitle: string,
    rejectionReason: string,
  ) {
    const subject = `Course Submission - Feedback Required`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const courseEditorUrl = `${frontendUrl}/instructor/courses`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #dc2626; border-bottom: 3px solid #dc2626; padding-bottom: 10px;">Course Submission - Feedback Required</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        
        <p>Thank you for submitting <strong>"${courseTitle}"</strong>. We've reviewed your course and have some feedback that needs to be addressed before it can be published.</p>
        
        <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
          <h3 style="color: #dc2626; margin-top: 0;">Feedback</h3>
          <p>${rejectionReason}</p>
        </div>
        
        <h3 style="color: #1f2937; margin-top: 20px;">What You Can Do:</h3>
        <ul>
          <li>Review the feedback provided above</li>
          <li>Make the necessary updates to your course</li>
          <li>Resubmit your course for review</li>
          <li>We'll prioritize reviewing your updated submission</li>
        </ul>
        
        <p style="margin-top: 20px;">
          <a href="${courseEditorUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Edit Your Course</a>
        </p>
        
        <p>If you have any questions about the feedback, please contact our support team.</p>
        <p>Best regards,<br/>E-Learning Platform Team</p>
      </div>
    `;

    const plainTextContent = `
Course Submission - Feedback Required

Dear ${firstName},

Thank you for submitting "${courseTitle}". We've reviewed your course and have some feedback that needs to be addressed before it can be published.

Feedback:
${rejectionReason}

What You Can Do:
- Review the feedback provided above
- Make the necessary updates to your course
- Resubmit your course for review
- We'll prioritize reviewing your updated submission

Edit Your Course: ${courseEditorUrl}

If you have any questions about the feedback, please contact our support team.

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
      return { success: true, message: `Course rejection email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendSimpleEmail(email: string, subject: string, htmlContent: string) {
    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
      });
      return { success: true, message: `Email sent to ${email}` };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * Send notification to instructor when student asks a question
   */
  async sendQuestionNotificationToInstructor(emailData: any, courseId: string) {
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/instructor/dashboard`;
    const questionUrl = `${frontendUrl}/instructor/questions/${courseId}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">New Question from Student</h2>
        
        <p>Dear Instructor,</p>
        
        <p>A student in your course has asked a question and is waiting for your response.</p>
        
        <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0;">
          <h3 style="color: #2563eb; margin-top: 0;">Question Details</h3>
          <p><strong>Student:</strong> ${emailData.studentName}</p>
          <p><strong>Question Title:</strong> ${emailData.questionTitle}</p>
          <p><strong>Category:</strong> ${emailData.category || 'General'}</p>
          <p><strong>Priority:</strong> ${emailData.priority || 'Medium'}</p>
        </div>
        
        <p><strong>Question:</strong></p>
        <p style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 15px 0;">
          ${emailData.content}
        </p>
        
        <p>Please log in to your instructor dashboard to view and respond to this question.</p>
        
        <p style="margin-top: 20px;">
          <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Go to Dashboard</a>
        </p>
        
        <p style="font-size: 12px; color: #666; margin-top: 30px;">
          This is an automated notification. Please do not reply to this email. Use your instructor dashboard to respond.
        </p>
        
        <p>Best regards,<br/>E-Learning Platform Team</p>
      </div>
    `;

    const plainTextContent = `
New Question from Student

Dear Instructor,

A student in your course has asked a question and is waiting for your response.

Question Details:
Student: ${emailData.studentName}
Question Title: ${emailData.questionTitle}
Category: ${emailData.category || 'General'}
Priority: ${emailData.priority || 'Medium'}

Question:
${emailData.content}

Please log in to your instructor dashboard to view and respond to this question.

Dashboard URL: ${dashboardUrl}

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: emailData.instructorEmail,
        subject: `New Question: ${emailData.questionTitle}`,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending question notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to student when instructor responds
   */
  async sendResponseNotificationToStudent(emailData: any, instructorId: string) {
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/student/dashboard`;
    const questionUrl = `${frontendUrl}/student/questions/${emailData.questionId}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #10b981; border-bottom: 3px solid #10b981; padding-bottom: 10px;">Your Question Has Been Answered!</h2>
        
        <p>Dear ${emailData.studentName},</p>
        
        <p>Your instructor has responded to your question! Log in to view the full response.</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
          <h3 style="color: #10b981; margin-top: 0;">Your Question</h3>
          <p><strong>${emailData.questionTitle}</strong></p>
        </div>
        
        <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
          <h3 style="color: #d97706; margin-top: 0;">Instructor's Response</h3>
          <p>${emailData.response}</p>
        </div>
        
        <p>You can:</p>
        <ul>
          <li>View the full conversation in your dashboard</li>
          <li>Add follow-up questions or feedback</li>
          <li>Rate the response to help us improve</li>
        </ul>
        
        <p style="margin-top: 20px;">
          <a href="${questionUrl}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">View Full Response</a>
        </p>
        
        <p style="font-size: 12px; color: #666; margin-top: 30px;">
          This is an automated notification. Please log in to your account to continue the conversation.
        </p>
        
        <p>Best regards,<br/>E-Learning Platform Team</p>
      </div>
    `;

    const plainTextContent = `
Your Question Has Been Answered!

Dear ${emailData.studentName},

Your instructor has responded to your question! Log in to view the full response.

Your Question:
${emailData.questionTitle}

Instructor's Response:
${emailData.response}

You can:
- View the full conversation in your dashboard
- Add follow-up questions or feedback
- Rate the response to help us improve

View Full Response: ${questionUrl}

Best regards,
E-Learning Platform Team
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: emailData.studentEmail,
        subject: `Answer: ${emailData.questionTitle}`,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending response notification:', error);
      throw error;
    }
  }

  /**
   * Send admin notification about flagged questions
   */
  async sendFlaggedQuestionNotificationToAdmin(adminEmail: string, flagData: any) {
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const adminDashboardUrl = `${frontendUrl}/admin/questions/${flagData.questionId}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #dc2626; border-bottom: 3px solid #dc2626; padding-bottom: 10px;">Question Flagged for Review</h2>
        
        <p>A question has been flagged and requires your attention.</p>
        
        <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
          <h3 style="color: #dc2626; margin-top: 0;">Flagged Question</h3>
          <p><strong>Title:</strong> ${flagData.title}</p>
          <p><strong>Student:</strong> ${flagData.studentName}</p>
          <p><strong>Reason:</strong> ${flagData.reason}</p>
          <p><strong>Notes:</strong> ${flagData.notes || 'None'}</p>
        </div>
        
        <p style="margin-top: 20px;">
          <a href="${adminDashboardUrl}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Review in Admin Dashboard</a>
        </p>
        
        <p>Best regards,<br/>E-Learning Platform System</p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: adminEmail,
        subject: `[ALERT] Question Flagged for Review: ${flagData.title}`,
        html: htmlContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending flag notification:', error);
      throw error;
    }
  }

  async sendModuleApprovalEmailToInstructor(
    email: string,
    firstName: string,
    moduleTitle: string,
  ) {
    const subject = `Your Module Has Been Approved! 🎉`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/instructor/modules`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">Module Approved! 🎉</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        <p>Congratulations! Your module <strong>"${moduleTitle}"</strong> has been <strong>APPROVED</strong> and is now live on the platform.</p>
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <h3 style="color: #16a34a; margin-top: 0;">What's Next?</h3>
          <ul>
            <li>Your module is now visible to students</li>
            <li>Students can discover and enroll in your module</li>
            <li>You can track student progress from your dashboard</li>
          </ul>
        </div>
        <p><a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">View Your Module</a></p>
        <p>Thank you for creating quality educational content!</p>
        <p>Best regards,<br/>Arin Publishing Academy Team</p>
      </div>
    `;

    const plainTextContent = `Module Approved!\n\nDear ${firstName},\n\nCongratulations! Your module "${moduleTitle}" has been APPROVED and is now live on the platform.\n\nStudents can now discover and enroll in your module.\n\nView your module: ${dashboardUrl}\n\nBest regards,\nArin Publishing Academy Team`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Module approval email sent to ${email}` };
    } catch (error) {
      console.error('Error sending module approval email:', error);
    }
  }

  async sendModuleRejectionEmailToInstructor(
    email: string,
    firstName: string,
    moduleTitle: string,
    rejectionReason: string,
  ) {
    const subject = `Module Submission — Feedback Required`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/instructor/modules`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #dc2626; border-bottom: 3px solid #dc2626; padding-bottom: 10px;">Module Submission — Feedback Required</h2>
        <p>Dear <strong>${firstName}</strong>,</p>
        <p>Thank you for submitting <strong>"${moduleTitle}"</strong>. After review, some updates are needed before it can be published.</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
          <h3 style="color: #dc2626; margin-top: 0;">Feedback from Admin</h3>
          <p>${rejectionReason}</p>
        </div>
        <p>Please address the feedback above and resubmit your module for review.</p>
        <p><a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Edit Your Module</a></p>
        <p>Best regards,<br/>Arin Publishing Academy Team</p>
      </div>
    `;

    const plainTextContent = `Module Submission — Feedback Required\n\nDear ${firstName},\n\nYour module "${moduleTitle}" requires revisions before it can be published.\n\nFeedback:\n${rejectionReason}\n\nPlease update your module and resubmit.\n\nEdit your module: ${dashboardUrl}\n\nBest regards,\nArin Publishing Academy Team`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Module rejection email sent to ${email}` };
    } catch (error) {
      console.error('Error sending module rejection email:', error);
    }
  }

  async sendModuleSubmissionNotificationToAdmin(
    adminEmail: string,
    instructorName: string,
    instructorEmail: string,
    moduleTitle: string,
    categoryName: string,
    moduleId: string,
  ) {
    const subject = `New Module Submission — ${moduleTitle}`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const adminDashboardUrl = `${frontendUrl}/admin/modules`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">New Module Submitted for Review</h2>
        <p>An instructor has submitted a new module that requires your approval.</p>
        <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0;">
          <h3 style="color: #2563eb; margin-top: 0;">Module Details</h3>
          <p><strong>Title:</strong> ${moduleTitle}</p>
          <p><strong>Instructor:</strong> ${instructorName} (${instructorEmail})</p>
          <p><strong>Category:</strong> ${categoryName}</p>
          <p><strong>Module ID:</strong> ${moduleId}</p>
        </div>
        <p><a href="${adminDashboardUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">Review in Admin Dashboard</a></p>
        <p>Best regards,<br/>Arin Publishing Academy System</p>
      </div>
    `;

    const plainTextContent = `New Module Submitted for Review\n\nAn instructor has submitted a new module.\n\nTitle: ${moduleTitle}\nInstructor: ${instructorName} (${instructorEmail})\nCategory: ${categoryName}\nModule ID: ${moduleId}\n\nReview: ${adminDashboardUrl}\n\nBest regards,\nArin Publishing Academy System`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: adminEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Module submission notification sent to admin` };
    } catch (error) {
      console.error('Error sending module submission notification:', error);
    }
  }

  /**
   * Notify instructor that a student submitted an essay assessment
   */
  async sendEssaySubmissionNotificationToInstructor(
    instructorEmail: string,
    instructorName: string,
    studentName: string,
    moduleName: string,
    enrollmentId: string,
  ) {
    const subject = `Essay Submitted for Review: ${moduleName}`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const reviewUrl = `${frontendUrl}/instructor/enrollments/${enrollmentId}/grade-essay`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">Essay Assessment Submitted</h2>
        <p>Dear <strong>${instructorName}</strong>,</p>
        <p>A student has submitted an essay assessment for your review.</p>
        <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0;">
          <p><strong>Student:</strong> ${studentName}</p>
          <p><strong>Module:</strong> ${moduleName}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        <p>Please review the essay and mark it as <strong>Pass</strong> or <strong>Fail</strong> with feedback.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${reviewUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Review Essay</a>
        </div>
        <p>Best regards,<br/><strong>Arin Publishing Academy</strong></p>
      </div>
    `;

    const plainTextContent = `Essay Assessment Submitted\n\nDear ${instructorName},\n\nStudent ${studentName} has submitted an essay for "${moduleName}" and is awaiting your review.\n\nReview here: ${reviewUrl}\n\nBest regards,\nArin Publishing Academy`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: instructorEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending essay submission notification:', error);
    }
  }

  /**
   * Notify student about their essay grading result
   */
  async sendEssayGradingResultToStudent(
    studentEmail: string,
    studentName: string,
    moduleName: string,
    passed: boolean,
    feedback: string,
    certificateUrl?: string,
  ) {
    const subject = passed
      ? `Essay Passed: ${moduleName} — Certificate Earned!`
      : `Essay Reviewed: ${moduleName} — Feedback Available`;

    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';

    const htmlContent = passed
      ? `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">Congratulations — Essay Passed!</h2>
        <p>Dear <strong>${studentName}</strong>,</p>
        <p>Your essay assessment for <strong>"${moduleName}"</strong> has been reviewed by your instructor and you have <strong style="color: #16a34a;">PASSED</strong>!</p>
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
          <h3 style="color: #16a34a; margin-top: 0;">Instructor Feedback</h3>
          <p>${feedback}</p>
        </div>
        ${certificateUrl ? `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${certificateUrl}" style="display: inline-block; background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Your Certificate</a>
        </div>
        ` : ''}
        <p>Keep up the excellent work!</p>
        <p>Best regards,<br/><strong>Arin Publishing Academy</strong></p>
      </div>
      `
      : `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d97706; border-bottom: 3px solid #d97706; padding-bottom: 10px;">Essay Reviewed — Feedback Available</h2>
        <p>Dear <strong>${studentName}</strong>,</p>
        <p>Your essay assessment for <strong>"${moduleName}"</strong> has been reviewed. Please read the feedback carefully and try again.</p>
        <div style="background-color: #fffbeb; border-left: 4px solid #d97706; padding: 15px; margin: 20px 0;">
          <h3 style="color: #d97706; margin-top: 0;">Instructor Feedback</h3>
          <p>${feedback}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${frontendUrl}/student/modules" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to My Modules</a>
        </div>
        <p>Best regards,<br/><strong>Arin Publishing Academy</strong></p>
      </div>
      `;

    const plainTextContent = passed
      ? `Essay Passed!\n\nDear ${studentName},\n\nYour essay for "${moduleName}" has been reviewed and you PASSED!\n\nInstructor Feedback:\n${feedback}\n\n${certificateUrl ? `View Certificate: ${certificateUrl}` : ''}\n\nBest regards,\nArin Publishing Academy`
      : `Essay Reviewed\n\nDear ${studentName},\n\nYour essay for "${moduleName}" has been reviewed. Please check the feedback below and try again.\n\nInstructor Feedback:\n${feedback}\n\nBest regards,\nArin Publishing Academy`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: studentEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending essay grading result:', error);
    }
  }

  /**
   * Notify a student about a new discussion post or reply in their enrolled module
   */
  async sendDiscussionNotificationToStudent(
    studentEmail: string,
    studentName: string,
    moduleName: string,
    lessonTitle: string,
    discussionTitle: string,
    discussionUrl: string,
    isReply: boolean,
  ) {
    const subject = isReply
      ? `New Reply in Discussion: ${discussionTitle}`
      : `New Discussion in ${moduleName}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c3aed; border-bottom: 3px solid #7c3aed; padding-bottom: 10px;">${isReply ? 'New Reply in Discussion' : 'New Discussion Posted'}</h2>
        <p>Dear <strong>${studentName}</strong>,</p>
        <p>${isReply ? 'A new reply has been posted in a discussion you are participating in.' : 'A new discussion has been posted in a module you are enrolled in.'}</p>
        <div style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; padding: 15px; margin: 20px 0;">
          <p><strong>Module:</strong> ${moduleName}</p>
          ${lessonTitle ? `<p><strong>Lesson:</strong> ${lessonTitle}</p>` : ''}
          <p><strong>Discussion:</strong> ${discussionTitle}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${discussionUrl}" style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Discussion</a>
        </div>
        <p>Best regards,<br/><strong>Arin Publishing Academy</strong></p>
      </div>
    `;

    const plainTextContent = `${isReply ? 'New Reply in Discussion' : 'New Discussion Posted'}\n\nDear ${studentName},\n\nModule: ${moduleName}\n${lessonTitle ? `Lesson: ${lessonTitle}\n` : ''}Discussion: ${discussionTitle}\n\nView Discussion: ${discussionUrl}\n\nBest regards,\nArin Publishing Academy`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: studentEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending discussion notification to student:', error);
    }
  }

  /**
   * Notify instructor when a student posts or replies in a discussion
   */
  async sendDiscussionNotificationToInstructor(
    instructorEmail: string,
    instructorName: string,
    studentName: string,
    moduleName: string,
    discussionTitle: string,
    discussionUrl: string,
  ) {
    const subject = `Student Reply in Discussion: ${discussionTitle}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">Student Replied to Discussion</h2>
        <p>Dear <strong>${instructorName}</strong>,</p>
        <p>A student has posted a reply in one of your course discussions.</p>
        <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0;">
          <p><strong>Student:</strong> ${studentName}</p>
          <p><strong>Module:</strong> ${moduleName}</p>
          <p><strong>Discussion:</strong> ${discussionTitle}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${discussionUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Discussion</a>
        </div>
        <p>Best regards,<br/><strong>Arin Publishing Academy</strong></p>
      </div>
    `;

    const plainTextContent = `Student Replied to Discussion\n\nDear ${instructorName},\n\nStudent: ${studentName}\nModule: ${moduleName}\nDiscussion: ${discussionTitle}\n\nView Discussion: ${discussionUrl}\n\nBest regards,\nArin Publishing Academy`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: instructorEmail,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending discussion notification to instructor:', error);
    }
  }

  /**
   * Send module inactivity reminder to a student
   */
  async sendModuleInactivityReminder(
    email: string,
    studentName: string,
    moduleName: string,
    progress: number,
    moduleId: string,
  ) {
    const subject = `Don't Stop Now — Continue "${moduleName}"`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const moduleUrl = `${frontendUrl}/student/modules/${moduleId}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #021d49 0%, #039e8e 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Keep Going — You've Got This!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px;">Dear <strong>${studentName}</strong>,</p>
          <p style="font-size: 16px;">It's been a few days since you last visited <strong>${moduleName}</strong>. Come back and continue your learning!</p>
          <div style="text-align: center; margin: 25px 0;">
            <div style="font-size: 48px; font-weight: bold; color: #021d49;">${Math.round(progress)}%</div>
            <div style="color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Completed</div>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${moduleUrl}" style="display: inline-block; background: linear-gradient(135deg, #021d49 0%, #039e8e 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px;">Continue Learning →</a>
          </div>
        </div>
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Arin Publishing Academy. All rights reserved.</p>
        </div>
      </div>
    `;

    const plainTextContent = `Keep Going!\n\nDear ${studentName},\n\nIt's been a few days since you last visited "${moduleName}". You're ${Math.round(progress)}% through — don't stop now!\n\nContinue Learning: ${moduleUrl}\n\nBest regards,\nArin Publishing Academy`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending module inactivity reminder:', error);
    }
  }

  /**
   * Send course completion reminder to inactive students
   */
  async sendCourseCompletionReminder(
    email: string,
    studentName: string,
    courseTitle: string,
    progress: number,
    courseId: string,
  ) {
    const subject = `⏰ Complete Your Course: ${courseTitle}`;
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const courseUrl = `${frontendUrl}/courses/${courseId}`;
    const dashboardUrl = `${frontendUrl}/student`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Don't Lose Your Progress!</h1>
        </div>
        
        <div style="background-color: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px;">Dear <strong>${studentName}</strong>,</p>
          
          <p style="font-size: 16px;">We noticed you haven't visited <strong>${courseTitle}</strong> in a while. Your learning journey is important to us!</p>
          
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 10px; padding: 20px; margin: 25px 0; text-align: center;">
            <div style="background-color: rgba(255, 255, 255, 0.9); border-radius: 8px; padding: 15px; display: inline-block;">
              <div style="font-size: 48px; font-weight: bold; color: #667eea; margin-bottom: 5px;">${Math.round(progress)}%</div>
              <div style="color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Completed</div>
            </div>
          </div>
          
          <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3 style="color: #10b981; margin-top: 0; font-size: 18px;">Why Continue?</h3>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li style="margin: 8px 0;">📚 Complete your learning goals</li>
              <li style="margin: 8px 0;">🏆 Earn your certificate of completion</li>
              <li style="margin: 8px 0;">💼 Add new skills to your professional portfolio</li>
              <li style="margin: 8px 0;">🎯 Stay on track with your personal development</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${courseUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
              Continue Learning →
            </a>
          </div>
          
          <div style="background-color: #eff6ff; padding: 20px; border-radius: 8px; margin-top: 25px;">
            <p style="margin: 0; font-size: 14px; color: #666;">
              <strong>💡 Pro Tip:</strong> Dedicate just 15-20 minutes daily to make steady progress. Consistency is key to mastering new skills!
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="${dashboardUrl}" style="color: #667eea; text-decoration: none; font-size: 14px;">View All My Courses</a>
          </div>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p>This is an automated reminder. You can manage your email preferences in your account settings.</p>
          <p>© ${new Date().getFullYear()} Arin Publishing Academy. All rights reserved.</p>
        </div>
      </div>
    `;

    const plainTextContent = `
Don't Lose Your Progress!

Dear ${studentName},

We noticed you haven't visited "${courseTitle}" in a while. Your learning journey is important to us!

Your Progress: ${Math.round(progress)}% Completed

Why Continue?
- Complete your learning goals
- Earn your certificate of completion
- Add new skills to your professional portfolio
- Stay on track with your personal development

Continue Learning: ${courseUrl}

Pro Tip: Dedicate just 15-20 minutes daily to make steady progress. Consistency is key to mastering new skills!

View All My Courses: ${dashboardUrl}

This is an automated reminder. You can manage your email preferences in your account settings.

© ${new Date().getFullYear()} Arin Publishing Academy. All rights reserved.
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_FROM_EMAIL') || 'noreply@elearning.com',
        to: email,
        subject,
        html: htmlContent,
        text: plainTextContent,
      });
      return { success: true, message: `Completion reminder sent to ${email}` };
    } catch (error) {
      console.error('Error sending completion reminder:', error);
      throw new Error(`Failed to send reminder: ${error.message}`);
    }
  }
}
