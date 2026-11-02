// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { SessionService } from './session/session.service';
import { SessionController } from './session/session.controller';
import { MfaService } from './mfa/mfa.service';
import { MfaController } from './mfa/mfa.controller';
import { PreviewTicketService } from './preview-ticket/preview-ticket.service';
import { PreviewTicketController } from './preview-ticket/preview-ticket.controller';

/**
 * Use JwtModule.registerAsync instead of register, because:
 *
 * JwtModule.register executes synchronously at the @Module decorator stage, when ConfigModule
 * has not yet loaded the .env file, so process.env.JWT_SECRET is undefined, causing secret
 * to fall back to 'your-secret-key', inconsistent with the process.env.JWT_SECRET read in JwtStrategy
 * (JwtStrategy's constructor executes at the dependency-injection stage, when .env is already loaded),
 * resulting in token signature verification failure (401 Unauthorized).
 *
 * registerAsync uses useFactory + inject:[ConfigService] to ensure secret is read only after
 * ConfigModule has loaded .env.
 */
@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, SessionController, MfaController, PreviewTicketController],
  providers: [AuthService, JwtStrategy, LocalStrategy, SessionService, MfaService, PreviewTicketService],
  exports: [AuthService, SessionService, MfaService],
})
export class AuthModule {}
