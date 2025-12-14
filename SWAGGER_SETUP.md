# Swagger/OpenAPI Setup Guide

## Overview

Your E-Learning API is now documented with Swagger (OpenAPI 3.0). This provides interactive API documentation and testing.

## Accessing Swagger UI

Once your backend server is running:

```
http://localhost:5000/docs
```

### Features Available:

- ✅ Interactive API documentation
- ✅ Test API endpoints directly from browser
- ✅ JWT Authentication support
- ✅ Request/Response examples
- ✅ Schema definitions
- ✅ Real-time API testing

## How Swagger is Configured

### 1. **Main Configuration** (`src/main.ts`)

```typescript
const config = new DocumentBuilder()
  .setTitle('E-Learning API')
  .setDescription('Complete E-Learning Platform API Documentation')
  .setVersion('1.0')
  .addBearerAuth({...}) // JWT support
  .addTag('Auth', 'Authentication endpoints')
  .addTag('Courses', 'Course management endpoints')
  // ... more tags
  .build();

SwaggerModule.setup('docs', app, document);
```

This sets up:

- **Base URL**: `/docs`
- **JWT Bearer Auth**: For protected endpoints
- **API Tags**: For organizing endpoints by category

### 2. **Controller Decorators** (Examples)

#### Authentication Controller

```typescript
@Controller('api/auth')
@ApiTags('Auth') // Groups endpoints
export class AuthController {
  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  async login(@Body() loginDto: LoginDto) { ... }
}
```

#### Certificate Controller (with public endpoints)

```typescript
@Get('public/:publicId')
@ApiOperation({ summary: 'Get certificate by public ID' })
@ApiParam({ name: 'publicId', description: 'Certificate UUID' })
@ApiResponse({ status: 200, description: 'Certificate data' })
async getPublicCertificate(@Param('publicId') publicId: string) { ... }
```

## Adding Swagger Documentation to Other Controllers

To add Swagger docs to any controller, follow this pattern:

### Step 1: Import Decorators

```typescript
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
```

### Step 2: Add Tags to Controller

```typescript
@Controller('api/your-resource')
@ApiTags('Your Resource Name')
export class YourController { ... }
```

### Step 3: Document Each Endpoint

```typescript
@Post('create')
@ApiOperation({ summary: 'Brief description of what this does' })
@ApiResponse({ status: 201, description: 'Success message' })
@ApiResponse({ status: 400, description: 'Error message' })
async create(@Body() dto: CreateDto) { ... }

@Get(':id')
@ApiOperation({ summary: 'Get resource by ID' })
@ApiParam({ name: 'id', description: 'Resource ID' })
@ApiResponse({ status: 200, description: 'Resource found' })
@ApiResponse({ status: 404, description: 'Resource not found' })
async getById(@Param('id') id: string) { ... }

@Put(':id')
@ApiBearerAuth('jwt-auth')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: 'Update resource' })
@ApiResponse({ status: 200, description: 'Updated successfully' })
async update(@Param('id') id: string, @Body() dto: UpdateDto) { ... }
```

## Common Swagger Decorators

| Decorator          | Purpose                  | Example                                                 |
| ------------------ | ------------------------ | ------------------------------------------------------- |
| `@ApiTags()`       | Group endpoints          | `@ApiTags('Users')`                                     |
| `@ApiOperation()`  | Describe endpoint        | `@ApiOperation({ summary: 'Create user' })`             |
| `@ApiResponse()`   | Document response        | `@ApiResponse({ status: 200, description: 'Success' })` |
| `@ApiBearerAuth()` | Mark as JWT protected    | `@ApiBearerAuth('jwt-auth')`                            |
| `@ApiParam()`      | Document path parameter  | `@ApiParam({ name: 'id', description: 'User ID' })`     |
| `@ApiQuery()`      | Document query parameter | `@ApiQuery({ name: 'limit', type: 'number' })`          |
| `@ApiBody()`       | Document request body    | `@ApiBody({ type: CreateUserDto })`                     |

## Using Swagger to Test APIs

### 1. **Without Authentication**

- Click on an endpoint
- Click "Try it out"
- Fill in parameters (if any)
- Click "Execute"
- View response

### 2. **With JWT Authentication**

1. Find the "Authorize" button (top right)
2. Click it
3. Enter your JWT token: `Bearer YOUR_TOKEN_HERE`
4. Click "Authorize"
5. Now all protected endpoints will include the token

### Example Workflow:

1. Call `/api/auth/login` to get token
2. Copy the token from response
3. Click "Authorize" and paste token
4. Call any protected endpoint

## Currently Documented Controllers

✅ **Auth** - Login, Register, Logout
✅ **Certificates** - Certificate generation, viewing, downloading
✅ **Courses** - Course creation, retrieval, updates

## Next Steps: Document These Controllers

The following controllers still need Swagger decorators (optional but recommended):

- Users
- Admin
- Discussions
- Questions
- Assessments
- Enrollments

Would you like me to add Swagger documentation to these as well?

## Deploy Swagger

When deploying to production:

```typescript
// In main.ts, conditionally show Swagger
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('docs', app, document);
}
```

Or always include it (your choice):

```typescript
// Always available
SwaggerModule.setup('docs', app, document);
```

## Troubleshooting

**Q: Swagger UI not loading?**
A: Make sure your backend is running on the correct port and visit `http://localhost:5000/docs`

**Q: Endpoints not showing?**
A: Add `@ApiTags()` decorator to your controller class

**Q: JWT not working in Swagger?**
A: Make sure you click "Authorize" button and enter the token with "Bearer " prefix

**Q: Want to hide certain endpoints?**
A: Add `@ApiExcludeEndpoint()` decorator to hide from Swagger UI

## References

- [NestJS Swagger Documentation](https://docs.nestjs.com/openapi/introduction)
- [Swagger/OpenAPI Specification](https://swagger.io/specification/)
