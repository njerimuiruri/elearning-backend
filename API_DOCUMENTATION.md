# E-Learning Platform - API Documentation

## Base URL

```
http://localhost:3001/api
```

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

---

## Authentication Endpoints

### Register Student

```http
POST /auth/register
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "securePassword123",
  "phoneNumber": "+1234567890",
  "country": "USA"
}
```

**Response** (201):

```json
{
  "user": {
    "_id": "...",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "role": "student"
  },
  "token": "eyJhbGc...",
  "message": "Registration successful"
}
```

### Register Instructor

```http
POST /auth/register-instructor
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "password": "securePassword123",
  "phoneNumber": "+1234567890",
  "institution": "Stanford University",
  "bio": "Expert in web development",
  "profilePhotoUrl": "https://...",
  "cvUrl": "https://..."
}
```

**Response** (201):

```json
{
  "user": { ... },
  "message": "Instructor registration submitted for approval. You will be notified once your account is approved."
}
```

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response** (200):

```json
{
  "user": { ... },
  "token": "eyJhbGc...",
  "message": "Login successful"
}
```

### Forgot Password

```http
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "john@example.com"
}
```

**Response** (200):

```json
{
  "success": true,
  "message": "If an account exists with this email, a reset link will be sent."
}
```

### Reset Password

```http
POST /auth/reset-password
Content-Type: application/json

{
  "token": "reset_token_from_email",
  "newPassword": "newPassword123",
  "confirmPassword": "newPassword123"
}
```

**Response** (200):

```json
{
  "success": true,
  "message": "Password reset successful"
}
```

### Set Initial Password (Admin-created students)

```http
POST /auth/set-initial-password
Content-Type: application/json

{
  "token": "setup_token_from_email",
  "password": "newPassword123",
  "confirmPassword": "newPassword123"
}
```

### Change Password

```http
PUT /auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "oldPassword123",
  "newPassword": "newPassword123",
  "confirmPassword": "newPassword123"
}
```

---

## Admin Endpoints

### Get Dashboard Statistics

```http
GET /admin/stats
Authorization: Bearer <admin_token>
```

**Response** (200):

```json
{
  "totalUsers": 1500,
  "activeUsers": 1200,
  "totalStudents": 1000,
  "totalInstructors": 50,
  "pendingInstructors": 5,
  "approvedInstructors": 45,
  "totalFellows": 450,
  "activeFellows": 400,
  "userGrowth": "+12.5%",
  "activeGrowth": "+8.3%"
}
```

### Get All Students

```http
GET /admin/students?page=1&limit=20&search=john
Authorization: Bearer <admin_token>
```

**Response** (200):

```json
{
  "students": [
    {
      "_id": "...",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "isActive": true,
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

### Create Single Student

```http
POST /admin/students
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phoneNumber": "+1234567890",
  "country": "USA"
}
```

**Response** (201):

```json
{
  "student": {
    "_id": "...",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  },
  "temporaryPassword": "abc123def456",
  "message": "Student created successfully. Registration email sent."
}
```

### Bulk Import Students

```http
POST /admin/students/bulk
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data

file: <csv_file>
```

**CSV Format**:

```
firstName,lastName,email,phoneNumber,country
John,Doe,john@example.com,+1234567890,USA
Jane,Smith,jane@example.com,+0987654321,UK
```

**Response** (201):

```json
{
  "message": "Bulk student creation completed. 50 created, 2 failed",
  "created": 50,
  "failed": 2,
  "students": [ ... ],
  "errors": [
    {
      "email": "invalid@example.com",
      "error": "Student with this email already exists"
    }
  ]
}
```

### Get All Instructors

```http
GET /admin/instructors?status=pending&page=1&limit=20
Authorization: Bearer <admin_token>
```

### Get Instructor Details

```http
GET /admin/instructors/:id
Authorization: Bearer <admin_token>
```

### Approve Instructor

```http
PUT /admin/instructors/:id/approve
Authorization: Bearer <admin_token>
```

**Response** (200):

```json
{
  "message": "Instructor approved successfully",
  "instructor": { ... }
}
```

### Reject Instructor

```http
PUT /admin/instructors/:id/reject
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "CV does not meet requirements"
}
```

---

## Course Endpoints

### Create Course (Instructor)

```http
POST /courses
Authorization: Bearer <instructor_token>
Content-Type: application/json

{
  "title": "Introduction to React",
  "description": "Learn React basics",
  "category": "Technology",
  "level": "beginner",
  "modules": [
    {
      "title": "Getting Started",
      "description": "Introduction to React",
      "content": "React is...",
      "videoUrl": "https://youtube.com/...",
      "duration": 30,
      "questions": [
        {
          "text": "What is React?",
          "type": "multiple-choice",
          "points": 10,
          "options": ["A", "B", "C"],
          "correctAnswer": "A",
          "explanation": "React is..."
        }
      ]
    }
  ],
  "thumbnailUrl": "https://..."
}
```

### Get Instructor's Courses

```http
GET /courses/instructor/my-courses
Authorization: Bearer <instructor_token>
```

### Submit Course for Approval

```http
POST /courses/:id/submit
Authorization: Bearer <instructor_token>
```

### Get All Published Courses

```http
GET /courses?category=technology&level=beginner&page=1&limit=20
```

**Response** (200):

```json
{
  "courses": [
    {
      "_id": "...",
      "title": "Introduction to React",
      "description": "...",
      "category": "Technology",
      "level": "beginner",
      "status": "published",
      "enrollmentCount": 250,
      "completionRate": 75,
      "instructorId": {
        "_id": "...",
        "firstName": "Jane",
        "lastName": "Smith",
        "avgRating": 4.8
      }
    }
  ],
  "pagination": { ... }
}
```

### Approve Course (Admin)

```http
PUT /courses/:id/approve
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "feedback": "Great course!"
}
```

### Reject Course (Admin)

```http
PUT /courses/:id/reject
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "Please add more practice questions"
}
```

### Publish Course (Admin)

```http
PUT /courses/:id/publish
Authorization: Bearer <admin_token>
```

---

## Enrollment Endpoints

### Enroll in Course

```http
POST /courses/:id/enroll
Authorization: Bearer <student_token>
```

**Response** (201):

```json
{
  "_id": "enrollment_id",
  "studentId": "...",
  "courseId": "...",
  "progress": 0,
  "isCompleted": false,
  "message": "Successfully enrolled in course"
}
```

### Get Student Enrollments

```http
GET /courses/student/my-enrollments
Authorization: Bearer <student_token>
```

**Response** (200):

```json
[
  {
    "_id": "...",
    "courseId": {
      "_id": "...",
      "title": "Introduction to React",
      "category": "Technology"
    },
    "progress": 45,
    "isCompleted": false,
    "lastAccessedAt": "2024-01-20T10:00:00Z"
  }
]
```

---

## Progress Endpoints

### Update Module Progress

```http
POST /courses/enrollment/:enrollmentId/progress
Authorization: Bearer <student_token>
Content-Type: application/json

{
  "moduleIndex": 0,
  "score": 85,
  "answers": [
    {
      "questionIndex": 0,
      "score": 10,
      "answered": true
    }
  ]
}
```

**Response** (200):

```json
{
  "progress": 50,
  "score": 425,
  "isCompleted": false
}
```

### Get Course Progress

```http
GET /courses/enrollment/:enrollmentId/progress
Authorization: Bearer <student_token>
```

---

## Certificate Endpoints

### Get Student Certificates

```http
GET /courses/student/certificates
Authorization: Bearer <student_token>
```

**Response** (200):

```json
[
  {
    "_id": "...",
    "studentName": "John Doe",
    "courseName": "Introduction to React",
    "certificateNumber": "CERT-1705741200000-a1b2",
    "scoreAchieved": 85,
    "issuedDate": "2024-01-20T10:00:00Z",
    "instructorName": "Jane Smith"
  }
]
```

---

## Discussion Endpoints

### Create Discussion

```http
POST /courses/:id/discussions
Authorization: Bearer <student_token>
Content-Type: application/json

{
  "instructorId": "...",
  "moduleIndex": 0,
  "title": "How to use hooks?",
  "content": "I don't understand how hooks work in React..."
}
```

### Get Course Discussions

```http
GET /courses/:id/discussions
Authorization: Bearer <token>
```

### Add Reply to Discussion

```http
POST /courses/discussions/:discussionId/reply
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Hooks allow you to use state in functional components..."
}
```

---

## Dashboard Endpoints

### Get Instructor Dashboard

```http
GET /courses/dashboard/instructor
Authorization: Bearer <instructor_token>
```

**Response** (200):

```json
{
  "totalCourses": 5,
  "totalEnrollments": 250,
  "totalStudents": 180,
  "completedEnrollments": 140,
  "averageRating": 4.7
}
```

### Get Student Dashboard

```http
GET /courses/dashboard/student
Authorization: Bearer <student_token>
```

**Response** (200):

```json
{
  "totalEnrollments": 8,
  "completedCourses": 3,
  "inProgressCourses": 5,
  "certificates": 3,
  "averageProgress": 65,
  "enrollments": [...]
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "statusCode": 400,
  "message": "Passwords do not match",
  "error": "Bad Request"
}
```

### 401 Unauthorized

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

### 403 Forbidden

```json
{
  "statusCode": 403,
  "message": "Access denied",
  "error": "Forbidden"
}
```

### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Student not found",
  "error": "Not Found"
}
```

### 409 Conflict

```json
{
  "statusCode": 409,
  "message": "User with this email already exists",
  "error": "Conflict"
}
```

---

## Rate Limiting

Currently not implemented but recommended for production:

- 100 requests per minute for authenticated users
- 10 requests per minute for unauthenticated endpoints

---

## Pagination

Endpoints that support pagination accept:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

Response includes:

```json
{
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

## Testing with cURL

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'
```

### Create Student (Admin)

```bash
curl -X POST http://localhost:3001/api/admin/students \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  }'
```

### Enroll in Course

```bash
curl -X POST http://localhost:3001/api/courses/60d5ec49c1234567890abcde/enroll \
  -H "Authorization: Bearer <token>"
```

---

## Webhook Events (Future)

Planned webhook events for production:

- `student.registered`
- `course.submitted`
- `course.approved`
- `course.enrolled`
- `course.completed`
- `certificate.issued`
- `discussion.created`
- `discussion.resolved`

---

End of API Documentation
