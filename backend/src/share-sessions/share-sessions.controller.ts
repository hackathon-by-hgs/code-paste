import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { CLOCK, type Clock } from '../common/clock';
import { zodBody } from '../http/zod-validation.pipe';
import { ShareSessionMapper } from '../persistence/mappers/share-session.mapper';
import { RateLimit } from '../rate-limiting/rate-limit.guard';
import { ShareSessionsService } from './share-sessions.service';
import {
  createShareSessionSchema,
  joinShareSessionSchema,
  listSessionsQuerySchema,
  revokeMemberSchema,
  type CreateShareSessionDto,
  type JoinShareSessionDto,
  type ListSessionsQueryDto,
  type RevokeMemberDto,
} from './share-sessions.dto';

@Controller('share-sessions')
export class ShareSessionsController {
  constructor(
    private readonly sessions: ShareSessionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(createShareSessionSchema)) body: CreateShareSessionDto,
  ) {
    const { session, joinCode } = await this.sessions.create(principal.user, body.expiresInSeconds);
    // joinCode is returned here and only here; it is stored as a hash and cannot be retrieved.
    return { ...ShareSessionMapper.toPublic(session, this.clock.now()), joinCode };
  }

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(zodBody(listSessionsQuerySchema)) query: ListSessionsQueryDto,
  ) {
    const page = await this.sessions.list(principal.user, {
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    const now = this.clock.now();
    return {
      data: page.data.map((s) => ShareSessionMapper.toPublic(s, now)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  async get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const session = await this.sessions.getForMember(principal.user, id);
    return ShareSessionMapper.toPublic(session, this.clock.now());
  }

  @Post(':id/join')
  @RateLimit('session-join')
  @HttpCode(200)
  async join(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(joinShareSessionSchema)) body: JoinShareSessionDto,
  ) {
    const session = await this.sessions.join(principal.user, id, body.joinCode);
    return ShareSessionMapper.toPublic(session, this.clock.now());
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<void> {
    await this.sessions.leave(principal.user, id);
  }

  @Post(':id/revoke-member')
  @HttpCode(200)
  async revokeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(revokeMemberSchema)) body: RevokeMemberDto,
  ) {
    const session = await this.sessions.revokeMember(principal.user, id, body.userId);
    return ShareSessionMapper.toPublic(session, this.clock.now());
  }

  /** The "stop sharing" button. */
  @Post(':id/expire')
  @HttpCode(200)
  async expire(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const session = await this.sessions.expire(principal.user, id);
    return ShareSessionMapper.toPublic(session, this.clock.now());
  }
}
