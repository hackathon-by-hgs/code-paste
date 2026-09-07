import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import type { User } from '../../users/user.entity';
import { DatabaseService, type Executor } from '../database.service';
import { UserMapper } from '../mappers/user.mapper';
import { users } from '../schema';
import type { CreateUserInput, UserRepository } from './user.repository';

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly database: DatabaseService) {}

  private ex(ex?: Executor): Executor {
    return ex ?? this.database.db;
  }

  async findById(id: string, ex?: Executor): Promise<User | null> {
    const [row] = await this.ex(ex).select().from(users).where(eq(users.id, id)).limit(1);
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByPublicId(publicId: string, ex?: Executor): Promise<User | null> {
    const [row] = await this.ex(ex).select().from(users).where(eq(users.publicId, publicId)).limit(1);
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string, ex?: Executor): Promise<User | null> {
    // Matches the `lower(email)` unique index, so lookup and uniqueness cannot disagree about
    // what counts as the same account.
    const [row] = await this.ex(ex)
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return row ? UserMapper.toDomain(row) : null;
  }

  async create(input: CreateUserInput, ex?: Executor): Promise<User> {
    const [row] = await this.ex(ex)
      .insert(users)
      .values({
        publicId: input.publicId,
        email: input.email,
        passwordHash: input.passwordHash,
        createdAt: input.createdAt,
      })
      .returning();
    return UserMapper.toDomain(row);
  }

  async findPublicIdsByIds(ids: string[], ex?: Executor): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.ex(ex)
      .select({ id: users.id, publicId: users.publicId })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.publicId]));
  }
}
