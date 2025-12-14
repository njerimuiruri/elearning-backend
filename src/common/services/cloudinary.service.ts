import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadImage(fileBuffer: Buffer, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'elearning/course-banners',
          resource_type: 'auto',
          public_id: fileName.replace(/\.[^/.]+$/, ''),
        },
        (error, result) => {
          if (error) reject(error);
          else if (result) resolve(result.secure_url);
          else reject(new Error('Upload failed'));
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  async uploadVideo(fileBuffer: Buffer, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'elearning/videos',
          resource_type: 'video',
          public_id: fileName.replace(/\.[^/.]+$/, ''),
          chunk_size: 6000000,
        },
        (error, result) => {
          if (error) reject(error);
          else if (result) resolve(result.secure_url);
          else reject(new Error('Upload failed'));
        },
      );

      uploadStream.end(fileBuffer);
    });
  }

  async deleteResource(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Error deleting resource from Cloudinary:', error);
    }
  }
}
