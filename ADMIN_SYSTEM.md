# E-Learning Backend - Admin & Instructor Approval System

## Overview

This document describes the admin user creation and instructor approval system for the e-learning platform.

## Admin User Setup

### Creating the First Admin User

To create an admin user, run the seed script:

```bash
npm run seed:admin
```

This will create an admin user with the following credentials:

- **Email**: `admin@elearning.com`
- **Password**: `Admin@123456`

**Important**: Change the password immediately after first login for security purposes.

### Admin Capabilities

As an admin, you can:

- View all users in the system
- View user statistics
- Review pending instructor applications
- Approve instructor applications (instructors can then login)
- Reject instructor applications (instructors receive rejection emails)

## Instructor Registration & Approval Workflow

### 1. Instructor Registration

- Instructors register through the `/api/auth/register-instructor` endpoint
- Their account is created with status **PENDING**
- Admin(s) receive an email notification about the pending application
- Instructors cannot login until their application is approved

### 2. Admin Review

- Admin logs in and views pending instructors at: `/api/users/instructors/pending`
- Endpoint returns all instructors with status `PENDING`

### 3. Approval or Rejection

#### Approve Instructor

```
PUT /api/users/:id/approve-instructor
```

- Changes instructor status to `APPROVED`
- Instructor receives approval email
- Instructor can now login to the platform

#### Reject Instructor

```
PUT /api/users/:id/reject-instructor
```

- Changes instructor status to `REJECTED`
- Instructor receives rejection email
- Instructor cannot login

## Email Configuration

### Setup Required Environment Variables

Create a `.env` file in the project root with email configuration:

```env
# Email Configuration (SMTP)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_password
SMTP_FROM_EMAIL=noreply@elearning.com
```

### Email Service Providers

#### Option 1: Mailtrap (Development)

- Great for testing, no real emails sent
- Sign up at: https://mailtrap.io
- Use credentials provided in dashboard

#### Option 2: Gmail (Production)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

- Create an App Password in Google Account settings
- Enable "Less secure app access" or use App Passwords

#### Option 3: SendGrid (Production)

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
```

- Sign up at: https://sendgrid.com
- Create API key in account settings

## API Endpoints

### Admin Endpoints (Requires JWT + ADMIN role)

#### Get All Users

```
GET /api/users
Query params: ?role=instructor (optional)
```

#### Get Pending Instructors

```
GET /api/users/instructors/pending
```

#### Approve Instructor

```
PUT /api/users/:instructorId/approve-instructor
```

Response:

```json
{
  "message": "Instructor approved successfully",
  "user": {
    "_id": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "role": "instructor",
    "instructorStatus": "approved"
  }
}
```

#### Reject Instructor

```
PUT /api/users/:instructorId/reject-instructor
```

Response:

```json
{
  "message": "Instructor rejected successfully",
  "user": {
    "_id": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "role": "instructor",
    "instructorStatus": "rejected"
  }
}
```

## Database Schema

### User Schema - Instructor Status Field

```typescript
enum InstructorStatus {
  PENDING = 'pending', // Awaiting admin approval
  APPROVED = 'approved', // Approved, can login
  REJECTED = 'rejected', // Rejected, cannot login
}
```

### Login Rules

- **Students**: Can login immediately after registration
- **Instructors**: Can only login if `instructorStatus === APPROVED`
- **Admins**: Can login immediately (full access)

## Email Templates

### Approval Email

Subject: "Your Instructor Application Approved"

- Notifies instructor of approval
- Provides login instructions
- Encourages them to create courses

### Rejection Email

Subject: "Your Instructor Application Rejected"

- Notifies instructor of rejection
- Allows reapplication in the future
- Provides support contact information

### Admin Notification Email

Subject: "New Instructor Registration Pending Approval"

- Sent to all admins when instructor registers
- Includes instructor details
- Links to admin dashboard

## Testing the System

### 1. Create Admin User

```bash
npm run seed:admin
```

### 2. Login as Admin

```
POST /api/auth/login
Body: {
  "email": "admin@elearning.com",
  "password": "Admin@123456"
}
```

### 3. Register as Instructor

```
POST /api/auth/register-instructor
Body: {
  "email": "instructor@example.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+1234567890",
  "institution": "University XYZ",
  "bio": "Experienced educator",
  "cvUrl": "url_to_cv",
  "profilePhotoUrl": "url_to_photo"
}
```

### 4. Get Pending Instructors (as Admin)

```
GET /api/users/instructors/pending
Headers: Authorization: Bearer <admin_token>
```

### 5. Approve Instructor (as Admin)

```
PUT /api/users/{instructorId}/approve-instructor
Headers: Authorization: Bearer <admin_token>
```

### 6. Instructor Tries to Login

After approval, instructor can login:

```
POST /api/auth/login
Body: {
  "email": "instructor@example.com",
  "password": "SecurePass123"
}
```

## Security Notes

- Admin credentials should be changed immediately
- JWT secrets must be strong and kept secure
- Email credentials should never be committed to version control
- Use environment variables for all sensitive data
- Consider implementing rate limiting on auth endpoints
- Add audit logging for admin approval actions

## Troubleshooting

### Email Not Sending

1. Check SMTP credentials in `.env`
2. Verify email provider account is active
3. Check firewall/network restrictions
4. Review email service provider logs
5. Ensure `SMTP_FROM_EMAIL` is valid

### Instructor Cannot Login After Approval

1. Verify `instructorStatus` is set to `APPROVED` in database
2. Check JWT token is valid
3. Ensure instructor email is verified

### Admin Endpoints Returning 403

1. Verify JWT token is valid
2. Check user role is set to `ADMIN`
3. Ensure `RolesGuard` is properly configured

## Future Enhancements

- [ ] Add instructor rejection reason/feedback field
- [ ] Implement email verification for instructors
- [ ] Add bulk approval/rejection functionality
- [ ] Send periodic reminders to pending instructors
- [ ] Add admin activity logging
- [ ] Implement instructor re-application after rejection
- [ ] Add approval deadline management
