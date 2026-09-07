import { Body, Controller, Delete, Get, HttpCode, Param, Post, Patch, Query } from '@nestjs/common';
import { CurrentDevice, CurrentPrincipal, Public, RequireDevice } from '../auth/decorators';
import type { DevicePrincipal, Principal } from '../auth/principal';
import { zodBody } from '../http/zod-validation.pipe';
import { DeviceMapper } from '../persistence/mappers/device.mapper';
import { UserMapper } from '../persistence/mappers/user.mapper';
import { RateLimit } from '../rate-limiting/rate-limit.guard';
import { DevicesService } from './devices.service';
import {
  listDevicesQuerySchema,
  registerDeviceSchema,
  updateDeviceSchema,
  type ListDevicesQueryDto,
  type RegisterDeviceDto,
  type UpdateDeviceDto,
} from './devices.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('pairing-codes')
  @RateLimit('pairing')
  @HttpCode(201)
  async createPairingCode(@CurrentPrincipal() principal: Principal) {
    const issued = await this.devices.issuePairingCode(principal.user);
    return {
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
      expiresInSeconds: issued.expiresInSeconds,
    };
  }

  /**
   * Authorised by a pairing code rather than a bearer token: the agent has no session yet.
   * `@Public()` here means "no access token", not "no authorization".
   */
  @Post()
  @Public()
  @RateLimit('register-device')
  @HttpCode(201)
  async register(@Body(zodBody(registerDeviceSchema)) body: RegisterDeviceDto) {
    const result = await this.devices.register(body);
    return {
      device: DeviceMapper.toPublic(result.device),
      credentials: {
        accessToken: result.credentials.accessToken,
        refreshToken: result.credentials.refreshToken,
        tokenType: 'Bearer' as const,
        expiresIn: result.credentials.expiresIn,
        user: UserMapper.toPublic(result.user),
      },
    };
  }

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(zodBody(listDevicesQuerySchema)) query: ListDevicesQueryDto,
  ) {
    const page = await this.devices.list(principal.user, {
      limit: query.limit,
      cursor: query.cursor,
      includeRevoked: query.includeRevoked,
    });
    return { data: page.data.map((device) => DeviceMapper.toPublic(device)), nextCursor: page.nextCursor };
  }

  @Get(':id')
  async get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return DeviceMapper.toPublic(await this.devices.getOwned(principal.user, id));
  }

  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(updateDeviceSchema)) body: UpdateDeviceDto,
  ) {
    return DeviceMapper.toPublic(await this.devices.update(principal.user, id, body));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return DeviceMapper.toPublic(await this.devices.revoke(principal.user, id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<void> {
    await this.devices.remove(principal.user, id);
  }

  /** Device-bound token only, and only for itself. No body: liveness is metadata, never content. */
  @Post(':id/heartbeat')
  @RequireDevice()
  @HttpCode(204)
  async heartbeat(@CurrentDevice() principal: DevicePrincipal, @Param('id') id: string): Promise<void> {
    await this.devices.heartbeat(principal.user, principal.device, id);
  }
}
