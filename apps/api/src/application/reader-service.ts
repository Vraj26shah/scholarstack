import type { HeartbeatDto, OpenReaderDto } from '@ss/contracts';
import type { Principal } from '../domain/entities';
import type {
  AccessLog,
  CatalogueReader,
  Clock,
  EntitlementRepository,
  IdGenerator,
  LeaseRepository,
  ObjectStore,
  ProfileRepository,
  ProgressRepository,
  RateLimiter,
  TileSeeder,
  TokenSigner,
} from '../domain/ports';
import type { AppConfig } from './config';
import { fail } from './errors';
import { unitLabel } from './mappers';

/** What a viewer token carries. Short-lived; lets page requests skip the database. */
export interface ViewerClaims extends Record<string, unknown> {
  u: string; // user id
  f: string; // file id
  d: string; // device id
  l: string; // lease id
  pc: number; // page count
}

export interface PageImage {
  body: ReadableStream | ArrayBuffer | Uint8Array;
  contentType: string;
  tileSeed: string;
}

export interface RequestMeta {
  ipHash: string;
  userAgent: string;
}

/** Opening a file, keeping the single reader lease alive, and serving scrambled pages. */
export class ReaderService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly entitlements: EntitlementRepository,
    private readonly profiles: ProfileRepository,
    private readonly leases: LeaseRepository,
    private readonly progress: ProgressRepository,
    private readonly accessLog: AccessLog,
    private readonly pages: ObjectStore,
    private readonly signer: TokenSigner,
    private readonly seeder: TileSeeder,
    private readonly limiter: RateLimiter,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  async open(
    principal: Principal,
    deviceId: string,
    fileId: string,
    isAdmin: boolean,
  ): Promise<OpenReaderDto> {
    const file = await this.catalogue.findFile(fileId);
    if (!file) throw fail.notFound('That file');
    const course = await this.catalogue.findCourse(file.courseId);
    if (!course || (course.status !== 'live' && !isAdmin)) throw fail.notFound('That file');
    if (!isAdmin && !(await this.entitlements.has(principal.userId, course.id))) throw fail.notPurchased();
    if (file.conversionStatus !== 'ready' || file.pageCount < 1) throw fail.notReady();
    if ((await this.accessLog.pagesToday(principal.userId)) >= this.config.pagesPerDay)
      throw fail.rateLimited();

    const leaseId = this.ids.next();
    await this.leases.put({
      userId: principal.userId,
      leaseId,
      deviceId,
      fileId,
      expiresAt: new Date(this.clock.now().getTime() + this.config.leaseSeconds * 1000),
    });

    const [profile, saved] = await Promise.all([
      this.profiles.ensure(principal),
      this.progress.get(principal.userId, fileId),
    ]);
    const { token, expiresAt } = await this.issueToken({
      u: principal.userId,
      f: fileId,
      d: deviceId,
      l: leaseId,
      pc: file.pageCount,
    });
    const stamp = this.clock.now().toISOString().slice(0, 16).replace('T', ' ');
    return {
      fileId,
      fileName: file.name,
      courseId: course.id,
      courseTitle: course.title,
      unitLabel: unitLabel(file.unitKey),
      pageCount: file.pageCount,
      lastPage: Math.min(saved?.page ?? 1, file.pageCount),
      viewerToken: token,
      expiresAt,
      watermark: `${(profile.fullName ?? principal.email.split('@')[0] ?? '').toUpperCase()} · ${principal.email} · ${stamp} UTC`,
    };
  }

  async heartbeat(
    principal: Principal,
    deviceId: string,
    viewerToken: string,
    input: { fileId: string; page: number; pagesViewed: number },
    meta: RequestMeta,
  ): Promise<HeartbeatDto> {
    const claims = await this.signer.verify<ViewerClaims>(viewerToken);
    if (!claims || claims.u !== principal.userId || claims.f !== input.fileId) throw fail.viewerToken();
    const lease = await this.leases.get(principal.userId);
    if (!lease || lease.leaseId !== claims.l || lease.deviceId !== deviceId) throw fail.leaseTaken();

    const today = await this.accessLog.addPages(
      principal.userId,
      input.fileId,
      input.pagesViewed,
      meta.ipHash,
      meta.userAgent,
    );
    if (today > this.config.pagesPerDay) throw fail.rateLimited();
    await this.progress.set(principal.userId, input.fileId, Math.min(input.page, claims.pc));
    await this.leases.put({
      ...lease,
      expiresAt: new Date(this.clock.now().getTime() + this.config.leaseSeconds * 1000),
    });
    const { token, expiresAt } = await this.issueToken({
      u: claims.u,
      f: claims.f,
      d: claims.d,
      l: claims.l,
      pc: claims.pc,
    });
    return { viewerToken: token, expiresAt };
  }

  /** Hot path: no database call. Token signature + rate limit + object read. */
  async page(viewerToken: string, fileId: string, pageNo: number, userId: string): Promise<PageImage> {
    const claims = await this.signer.verify<ViewerClaims>(viewerToken);
    if (!claims || claims.f !== fileId || claims.u !== userId) throw fail.viewerToken();
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > claims.pc) throw fail.notFound('That page');
    if (!(await this.limiter.allow(`pages:${claims.u}`))) throw fail.rateLimited();
    const object = await this.pages.get(`pages/${fileId}/${pageNo}.webp`);
    if (!object) throw fail.notFound('That page');
    return { ...object, tileSeed: await this.seeder.seedFor(fileId, pageNo) };
  }

  private async issueToken(claims: ViewerClaims): Promise<{ token: string; expiresAt: string }> {
    const ttl = this.config.viewerTokenTtlSeconds;
    const token = await this.signer.sign(claims, ttl);
    return { token, expiresAt: new Date(this.clock.now().getTime() + ttl * 1000).toISOString() };
  }
}
