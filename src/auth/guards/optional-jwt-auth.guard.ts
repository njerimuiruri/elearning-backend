import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects the request when no/invalid token is
 * present  it just leaves req.user undefined. Used on routes that must stay
 * publicly browsable (marketing/catalog pages) while still personalizing
 * the response for logged-in users (e.g. category-based content filtering).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
