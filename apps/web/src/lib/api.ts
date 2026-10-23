import type {
  AdminBundleDto,
  AdminCourseDto,
  AdminUnitDto,
  AdminSyncHealthDto,
  AnnouncementDto,
  ApiErrorBody,
  BundleCardDto,
  BundleDetailDto,
  CatalogueIndexDto,
  CourseCardDto,
  CourseDetailDto,
  CourseInventoryDto,
  EmailStatusDto,
  ErrorCode,
  FeatureDto,
  FeatureStatus,
  HeartbeatDto,
  ImportCourseInput,
  ImportTreeDto,
  MeDto,
  OpenReaderDto,
  OrderDto,
  ShelfItemDto,
  StartCheckoutDto,
  StorageAuditDto,
  StorageInventoryPageDto,
  SyncResultDto,
} from '@ss/contracts';
import { TILE_SEED_HEADER, VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { env } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type TokenSource = () => Promise<string | null>;
type ProblemListener = (error: ApiError) => void;

/**
 * Thin typed client for the Worker API. Knows nothing about React; the auth layer
 * gives it a token source, and session problems are broadcast to one listener.
 */
export class ApiClient {
  private tokenSource: TokenSource = async () => null;
  private onProblem: ProblemListener = () => {};
  private claimer: (() => Promise<void>) | null = null;
  private claiming: Promise<void> | null = null;

  constructor(private readonly base: string) {}

  useTokens(source: TokenSource) {
    this.tokenSource = source;
  }

  onSessionProblem(listener: ProblemListener) {
    this.onProblem = listener;
  }

  /** How to claim this device. Called once however many requests need it at the same time. */
  useClaimer(claim: () => Promise<void>) {
    this.claimer = claim;
  }

  private claimOnce(): Promise<void> {
    if (!this.claimer) return Promise.resolve();
    this.claiming ??= this.claimer()
      .catch(() => {})
      .finally(() => {
        this.claiming = null;
      });
    return this.claiming;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    retried = false,
  ): Promise<T> {
    const token = await this.tokenSource();
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    const err = (await res.json().catch(() => null)) as
      | (ApiErrorBody & { error: { details?: unknown } })
      | null;
    const apiError = new ApiError(
      res.status,
      err?.error.code ?? 'INTERNAL',
      err?.error.message ?? 'Something went wrong.',
      err?.error.details,
    );
    // A page that loads several things at once must not claim the device several times
    // (that registered extra devices and signed the user out). One claim, then retry once.
    if (apiError.code === 'DEVICE_UNCLAIMED' && !retried && path !== '/session/claim' && this.claimer) {
      await this.claimOnce();
      return this.request<T>(method, path, body, headers, true);
    }
    if (apiError.code === 'SESSION_REPLACED' || apiError.code === 'DEVICE_UNCLAIMED')
      this.onProblem(apiError);
    throw apiError;
  }

  // Catalogue
  catalogue = () => this.request<CatalogueIndexDto>('GET', '/catalogue');
  drawer = (batch: number, branch: string) =>
    this.request<CourseCardDto[]>(
      'GET',
      `/catalogue/drawer?batch=${batch}&branch=${encodeURIComponent(branch)}`,
    );
  course = (idOrSlug: string) =>
    this.request<CourseDetailDto>('GET', `/courses/${encodeURIComponent(idOrSlug)}`);
  bundles = (batch?: number) =>
    this.request<BundleCardDto[]>('GET', `/bundles${batch ? `?batch=${batch}` : ''}`);
  bundle = (idOrSlug: string) =>
    this.request<BundleDetailDto>('GET', `/bundles/${encodeURIComponent(idOrSlug)}`);
  /** Public, cacheable first page of a unit. Safe as an <img src>. */
  // Bump this when preview content is quarantined or regenerated. Preview responses
  // are browser-cacheable, so a versioned URL prevents an old bad image resurfacing.
  previewUrl = (fileId: string) => `${this.base}/previews/${fileId}?v=2`;
  features = () => this.request<FeatureDto[]>('GET', '/features');
  unsubscribe = (token: string) => this.request<{ ok: true }>('POST', '/email/unsubscribe', { token });

  // Account
  claim = (label: string) => this.request<MeDto>('POST', '/session/claim', { label });
  me = () => this.request<MeDto>('GET', '/me');
  updateName = (fullName: string) => this.request<MeDto>('PATCH', '/me', { fullName });
  removeDevice = (id: string) => this.request<MeDto>('DELETE', `/me/devices/${id}`);
  setEmailOptIn = (emailOptIn: boolean) => this.request<MeDto>('PUT', '/me/email', { emailOptIn });
  shelf = () => this.request<ShelfItemDto[]>('GET', '/me/shelf');

  // Checkout
  startCheckout = (item: { courseId: string } | { bundleId: string }) =>
    this.request<StartCheckoutDto>('POST', '/orders', item);
  verifyPayment = (b: {
    orderId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }) => this.request<OrderDto>('POST', '/orders/verify', b);
  order = (id: string) => this.request<OrderDto>('GET', `/orders/${id}`);

  // Reader
  openReader = (fileId: string) => this.request<OpenReaderDto>('POST', '/reader/open', { fileId });
  heartbeat = (viewerToken: string, b: { fileId: string; page: number; pagesViewed: number }) =>
    this.request<HeartbeatDto>('POST', '/reader/heartbeat', b, { [VIEWER_TOKEN_HEADER]: viewerToken });

  /** Fetches one scrambled page image and its tile seed. */
  async page(viewerToken: string, fileId: string, page: number): Promise<{ blob: Blob; seed: string }> {
    const res = await fetch(`${this.base}/reader/pages/${fileId}/${page}`, {
      headers: { [VIEWER_TOKEN_HEADER]: viewerToken },
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        res.status,
        err?.error.code ?? 'INTERNAL',
        err?.error.message ?? 'Could not load the page.',
      );
    }
    return { blob: await res.blob(), seed: res.headers.get(TILE_SEED_HEADER) ?? '' };
  }

  // Admin
  adminCourses = () => this.request<AdminCourseDto[]>('GET', '/admin/courses');
  adminSyncHealth = () => this.request<AdminSyncHealthDto>('GET', '/admin/sync-health');
  adminStorageAudit = (courseId: string) =>
    this.request<StorageAuditDto>('GET', `/admin/storage-audit?courseId=${encodeURIComponent(courseId)}`);
  adminStorageInventoryPage = (cursor?: string, prefix = '') => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (prefix) params.set('prefix', prefix);
    const query = params.size ? `?${params.toString()}` : '';
    return this.request<StorageInventoryPageDto>('GET', `/admin/storage-audit/bucket${query}`);
  };
  /** Empty-prefix scope now performs only the bucket-wide orphan-page sweep. */
  adminCleanupOrphanPages = () =>
    this.request<SyncResultDto>('POST', '/admin/storage-audit/sync-scope', { prefix: '' });
  adminUnits = (courseId: string) => this.request<AdminUnitDto[]>('GET', `/admin/courses/${courseId}/units`);
  adminInventory = (courseId: string) =>
    this.request<CourseInventoryDto>('GET', `/admin/courses/${courseId}/inventory`);
  adminSyncFile = (courseId: string, sourceKey: string) =>
    this.request<SyncResultDto>('POST', `/admin/courses/${courseId}/sync-file`, { sourceKey });
  adminSyncFolder = (courseId: string, prefix: string) =>
    this.request<SyncResultDto>('POST', `/admin/courses/${courseId}/sync-folder`, { prefix });
  adminSetUnitHidden = (courseId: string, key: string, hidden: boolean) =>
    this.request<AdminUnitDto[]>('PUT', `/admin/courses/${courseId}/units/${encodeURIComponent(key)}`, {
      hidden,
    });
  adminSetFileHidden = (fileId: string, hidden: boolean) =>
    this.request<AdminUnitDto[]>('PUT', `/admin/files/${fileId}`, { hidden });
  adminRetryConversion = (fileId: string) =>
    this.request<{ ok: true; queued: number }>('POST', `/admin/files/${fileId}/retry-conversion`);
  adminImportTree = () => this.request<ImportTreeDto>('GET', '/admin/import');
  adminImport = (courses: ImportCourseInput[]) =>
    this.request<SyncResultDto>('POST', '/admin/import', { courses });
  adminUpdateCourse = (
    id: string,
    patch: Partial<{
      title: string;
      courseCode: string | null;
      description: string;
      batchYear: number;
      branchSlugs: string[];
      branchSlug: string;
      semester: number;
      pricePaise: number;
      status: 'draft' | 'live' | 'archived';
    }>,
  ) => this.request<{ ok: true }>('PATCH', `/admin/courses/${id}`, patch);
  adminBundles = () => this.request<AdminBundleDto[]>('GET', '/admin/bundles');
  adminSaveBundle = (b: {
    id?: string;
    title: string;
    description: string;
    batchYear: number | null;
    courseIds: string[];
    pricePaise: number;
    status: 'draft' | 'live' | 'archived';
  }) => this.request<AdminBundleDto>('POST', '/admin/bundles', b);
  adminSuggestPrice = (courseIds: string[]) =>
    this.request<{ pricePaise: number }>('POST', '/admin/bundles/suggest-price', { courseIds });
  adminFeatures = () => this.request<FeatureDto[]>('GET', '/admin/features');
  adminSaveFeature = (key: string, f: { title: string; blurb: string; status: FeatureStatus }) =>
    this.request<FeatureDto>('PUT', `/admin/features/${key}`, f);
  adminCreateFeature = (f: { key: string; title: string; blurb: string; status: FeatureStatus }) =>
    this.request<FeatureDto>('POST', '/admin/features', f);
  adminLaunchFeature = (key: string) =>
    this.request<AnnouncementDto>('POST', `/admin/features/${key}/launch`);
  adminEmailStatus = () => this.request<EmailStatusDto>('GET', '/admin/email');
  adminAnnouncements = () => this.request<AnnouncementDto[]>('GET', '/admin/announcements');
  adminSaveAnnouncement = (a: {
    id?: string;
    subject: string;
    heading: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    featureKey: string | null;
  }) => this.request<AnnouncementDto>('POST', '/admin/announcements', a);
  adminPreviewAnnouncement = (id: string) =>
    this.request<{ subject: string; html: string }>('GET', `/admin/announcements/${id}/preview`);
  adminTestAnnouncement = (id: string) =>
    this.request<{ ok: true; to: string }>('POST', `/admin/announcements/${id}/test`);
  adminSendAnnouncement = (id: string) =>
    this.request<AnnouncementDto>('POST', `/admin/announcements/${id}/send`);
  adminPublish = (courseId: string, pricePaise: number) =>
    this.request<{ ok: true }>('POST', `/admin/courses/${courseId}/publish`, { pricePaise });

  // Demo-only stand-ins (404 on a real deployment)
  demoLogin = (email: string) =>
    this.request<{ accessToken: string; email: string }>('POST', '/dev/login', { email });
  demoOutbox = () => this.request<{ to: string; subject: string; html: string }[]>('GET', '/dev/outbox');
  demoPay = (gatewayOrderId: string) =>
    this.request<{ gatewayPaymentId: string; signature: string }>('POST', '/dev/pay', { gatewayOrderId });
}

export const api = new ApiClient(env.apiBase);

/** Friendly text for every error code. */
export function friendly(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_COLLEGE_EMAIL':
        return `Only @${env.domain} accounts can sign in.`;
      case 'RATE_LIMITED':
        return "You're going a bit fast. Take a breath and try again in a minute.";
      case 'NOT_PURCHASED':
        return 'Buy this course to open its files.';
      case 'NOT_READY':
        return 'This file is still being prepared. Check back in a few minutes.';
      case 'SYNC_FAILED':
        return error.message;
      default:
        return error.message;
    }
  }
  return 'Something went wrong. Please try again.';
}
