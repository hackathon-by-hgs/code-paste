import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { DeviceMapper } from '../persistence/mappers/device.mapper';
import { UserMapper } from '../persistence/mappers/user.mapper';
import { RateLimit } from '../rate-limiting/rate-limit.guard';
import { zodBody } from '../http/zod-validation.pipe';
import { AuthService, type AuthResult } from './auth.service';
import {
  loginSchema,
  refreshSchema,
  signupSchema,
  type LoginDto,
  type RefreshDto,
  type SignupDto,
} from './auth.dto';
import { CurrentPrincipal, Public } from './decorators';
import type { Principal } from './principal';

/**
 * Transport only.
 *
 * Parses, delegates to AuthService, formats via mappers. No business rule and no authorization
 * decision lives here — that is what makes the WebSocket layer able to reuse the same services
 * without a second implementation of the rules.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @Public()
  @RateLimit('signup')
  @HttpCode(201)
  async signup(@Body(zodBody(signupSchema)) body: SignupDto) {
    return this.toTokenPair(await this.auth.signup(body.email, body.password));
  }

  @Post('login')
  @Public()
  @RateLimit('login')
  @HttpCode(200)
  async login(@Body(zodBody(loginSchema)) body: LoginDto) {
    return this.toTokenPair(await this.auth.login(body.email, body.password));
  }

  @Post('refresh')
  @Public()
  @RateLimit('refresh')
  @HttpCode(200)
  async refresh(@Body(zodBody(refreshSchema)) body: RefreshDto) {
    return this.toTokenPair(await this.auth.refresh(body.refreshToken));
  }

  @Post('logout')
  @Public()
  @RateLimit('refresh')
  @HttpCode(204)
  async logout(@Body(zodBody(refreshSchema)) body: RefreshDto): Promise<void> {
    // Always 204, even for an unknown token, so logout is not a token-validity oracle.
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentPrincipal() principal: Principal) {
    return {
      user: UserMapper.toPublic(principal.user),
      principal: principal.kind,
      device: principal.device ? DeviceMapper.toPublic(principal.device) : null,
    };
  }

  private toTokenPair(result: AuthResult) {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: result.expiresIn,
      user: UserMapper.toPublic(result.user),
    };
  }
}
