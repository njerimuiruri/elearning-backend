# Email Setup Guide for E-Learning Platform

## Why Emails Are Not Sending

Common reasons:

1. ❌ SMTP credentials not configured
2. ❌ Gmail blocking "less secure apps"
3. ❌ 2-Factor Authentication enabled without app password
4. ❌ Firewall blocking SMTP ports
5. ❌ Wrong SMTP host/port combination

## Quick Fix (Gmail - Recommended)

### Step 1: Enable 2-Factor Authentication

1. Go to https://myaccount.google.com/security
2. Click "2-Step Verification"
3. Follow the setup wizard

### Step 2: Generate App Password

1. Go to https://myaccount.google.com/apppasswords
2. Select app: "Mail"
3. Select device: "Other (Custom name)"
4. Enter: "E-Learning Platform"
5. Click "Generate"
6. **Copy the 16-character password** (you'll only see it once!)

### Step 3: Update Backend .env

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
# ^ Use the 16-character app password (spaces are OK)
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

### Step 4: Restart Backend

```bash
cd elearning-backend
# Stop the server (Ctrl+C)
npm run start:dev
```

### Step 5: Test Email

In your backend, the email service will now work for:

- ✅ Instructor approval/rejection notifications
- ✅ Student registration emails
- ✅ Password reset emails
- ✅ Course completion certificates
- ✅ System notifications

## Alternative: SendGrid (For High Volume)

### Benefits

- 100 emails/day free tier
- Professional email delivery
- Email analytics
- Better deliverability than Gmail

### Setup Steps

1. **Sign up**: https://sendgrid.com
2. **Create API Key**:
   - Go to Settings > API Keys
   - Click "Create API Key"
   - Name: "E-Learning Platform"
   - Permission: "Full Access"
   - Copy the key

3. **Update .env**:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
# ^ Literally type "apikey" - not your username!
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxxxx
# ^ Paste your actual API key here
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

4. **Verify Sender Email** (Important!):
   - Go to Settings > Sender Authentication
   - Click "Verify a Single Sender"
   - Use your actual email (e.g., support@yourdomain.com)
   - Check your inbox and verify

## Development: Mailtrap (Testing)

### Why Use Mailtrap?

- ✅ Safe email testing (no real emails sent)
- ✅ View all sent emails in web interface
- ✅ Free forever
- ✅ Perfect for development

### Setup

1. **Sign up**: https://mailtrap.io
2. **Get Credentials**:
   - Go to Email Testing > Inboxes
   - Click on your inbox
   - Copy SMTP credentials

3. **Update .env**:

```env
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_username
SMTP_PASS=your_mailtrap_password
SMTP_FROM_EMAIL=test@elearning.com
```

4. **View Sent Emails**:
   - Go to https://mailtrap.io/inboxes
   - All emails appear here instead of real inboxes

## Troubleshooting

### Error: "Invalid login"

**Solution**: Double-check SMTP_USER and SMTP_PASS

- Gmail: Use app password, not regular password
- SendGrid: SMTP_USER must be exactly "apikey"

### Error: "Connection timeout"

**Solution**: Check firewall/antivirus

```bash
# Test SMTP connection (Windows PowerShell)
Test-NetConnection smtp.gmail.com -Port 587

# Should show: TcpTestSucceeded : True
```

### Error: "Self-signed certificate"

**Solution**: Update Node.js or add to email.service.ts:

```typescript
this.transporter = nodemailer.createTransport({
  host: '...',
  port: 587,
  secure: false,
  auth: {
    /*...*/
  },
  tls: { rejectUnauthorized: false }, // Add this for development only
});
```

### Emails Going to Spam

**Solutions**:

1. Use SendGrid (better deliverability)
2. Set up SPF/DKIM records for your domain
3. Use a verified domain email (not @gmail.com)
4. Add unsubscribe link in emails

## Testing Email Functionality

### 1. Test Instructor Approval Email

```bash
# In your frontend, register as an instructor
# Then in admin panel, approve the instructor
# Check email inbox (or Mailtrap if using development)
```

### 2. Test Student Registration

```bash
# As admin, create a new student
# Student should receive welcome email with temporary password
```

### 3. Manual Test (Backend Console)

Create a test file `test-email.ts`:

```typescript
import { EmailService } from './src/common/services/email.service';
import { ConfigService } from '@nestjs/config';

const configService = new ConfigService();
const emailService = new EmailService(configService);

emailService
  .sendInstructorApprovalEmail('test@example.com', 'John', true)
  .then(() => {
    console.log('✅ Email sent successfully!');
  })
  .catch((err) => {
    console.error('❌ Email failed:', err.message);
  });
```

## Production Best Practices

1. **Use Environment Variables**

   ```bash
   # Don't use .env in production
   # Set environment variables directly:
   export SMTP_HOST=smtp.sendgrid.net
   export SMTP_PASS=your_api_key
   ```

2. **Use a Custom Domain**
   - Instead of: noreply@gmail.com
   - Use: noreply@yourdomain.com

3. **Set up Email Templates**
   - The platform already uses HTML templates
   - Customize in `src/common/services/email.service.ts`

4. **Monitor Email Delivery**
   - SendGrid provides analytics
   - Track open rates, click rates, bounces

5. **Add Email Queue** (Advanced)
   - For high volume, use Bull Queue
   - Prevents blocking on email send
   - Retry failed emails

## Quick Reference: Email Ports

| Port | Type  | Encryption | Use Case         |
| ---- | ----- | ---------- | ---------------- |
| 25   | SMTP  | None       | Legacy (blocked) |
| 587  | SMTP  | STARTTLS   | **Recommended**  |
| 465  | SMTPS | SSL/TLS    | Secure (Gmail)   |
| 2525 | SMTP  | STARTTLS   | Development      |

## Need Help?

1. Check backend console logs for email errors
2. Verify .env file exists and is loaded
3. Test SMTP connection with telnet:
   ```bash
   telnet smtp.gmail.com 587
   # Should connect successfully
   ```
4. Enable email service debugging:
   ```typescript
   // In email.service.ts
   this.transporter = nodemailer.createTransport({
     // ...
     debug: true,
     logger: true,
   });
   ```

## Current Email Templates

The platform sends these emails:

1. **Instructor Approval** (`sendInstructorApprovalEmail`)
   - Sent when admin approves/rejects instructor
   - Includes login credentials (approval only)

2. **Instructor Registration Notification** (`sendInstructorRegistrationNotificationToAdmin`)
   - Notifies admin of new instructor signup
   - Includes instructor details for review

3. **Student Registration** (needs implementation)
   - Welcome email with temporary password
   - Platform overview and next steps

4. **Password Reset** (needs implementation)
   - Secure reset link
   - Expires after 1 hour

5. **Certificate Earned** (needs implementation)
   - Congratulations message
   - Download link for certificate

All templates support HTML with professional styling!
