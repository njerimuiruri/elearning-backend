import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'E-Learning Platform API - Server is running!';
  }
}