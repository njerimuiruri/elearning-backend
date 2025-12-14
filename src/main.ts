import 'dotenv/config';  
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import connectDB from '../database/connect';  
import * as express from 'express';

async function bootstrap() {
  await connectDB();
  
  const app = await NestFactory.create(AppModule);
  
  // CORS Configuration - Allow multiple origins
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.FRONTEND_URL,
  ].filter(Boolean); // Remove undefined values

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️ CORS blocked origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Disposition'],
  });
  
  // Increase payload size limit for course creation with large module data
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  
  app.useGlobalPipes(new ValidationPipe());
  
  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('E-Learning API')
    .setDescription('Complete E-Learning Platform API Documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'jwt-auth',
    )
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Courses', 'Course management endpoints')
    .addTag('Enrollments', 'Student enrollment endpoints')
    .addTag('Assessments', 'Assessment and grading endpoints')
    .addTag('Certificates', 'Certificate generation and management')
    .addTag('Users', 'User management endpoints')
    .addTag('Admin', 'Admin panel endpoints')
    .addTag('Discussions', 'Course discussions and forums')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayOperationId: true,
    },
  });

  console.log(`📚 Swagger UI available at http://localhost:${process.env.PORT || 5000}/docs`);
  
  const port = process.env.PORT || 5000;
  await app.listen(port);
  
  console.log(`Server running on http://localhost:${port}`);
  console.log(`E-Learning Backend is ready!`);
}
bootstrap();