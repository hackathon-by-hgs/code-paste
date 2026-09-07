import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  // TokenService and AuthService are exported for the guards and for the realtime gateway, which
  // authenticates its handshake through exactly the same code path as HTTP (ADR-006).
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
