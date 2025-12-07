import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EmailService } from './common/services/email.service';

async function testEmail() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const emailService = app.get(EmailService);

  try {
    console.log('Testing email configuration...');
    console.log('Sending test email to: faith.muiruri@strathmore.edu');

    await emailService.sendInstructorApprovalEmail(
      'faith.muiruri@strathmore.edu',
      'Faith',
      true
    );

    console.log('✅ SUCCESS! Email sent successfully!');
    console.log('Check your inbox at faith.muiruri@strathmore.edu');
  } catch (error) {
    console.error('❌ ERROR sending email:', error.message);
    console.error('Full error:', error);
  }

  await app.close();
}

testEmail();
