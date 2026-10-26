import type {
  AcademicDto,
  AccessChangeInput,
  AccessGrantInput,
  AdminBundleDto,
  AdminContributionDto,
  AdminCourseAccessDto,
  AdminCourseDto,
  AdminGrantResultDto,
  AdminOverviewDto,
  AdminSupportQueryDto,
  AdminSyncHealthDto,
  AdminTodayDto,
  AdminUnitDto,
  AnnouncementDto,
  ApiErrorBody,
  BranchSaveInput,
  BundleCardDto,
  BundleDetailDto,
  CatalogueIndexDto,
  CatalogueSearchDto,
  ContributionMetaInput,
  ContributionReviewInput,
  ContributionStatusDto,
  ContributorStatsDto,
  ConversionBoardDto,
  ConvertScopeInput,
  ConvertScopeResultDto,
  CourseCardDto,
  CourseDetailDto,
  CourseInventoryDto,
  DeleteCourseResultDto,
  DeliveryDto,
  EarningsDto,
  EmailStatusDto,
  ErrorCode,
  FeatureDto,
  FeatureStatus,
  FilePlanDto,
  HeartbeatDto,
  ImportCourseInput,
  ImportTreeDto,
  MeDto,
  MoveCourseFolderInput,
  MoveCourseFolderResultDto,
  MyContributionDto,
  MySupportDto,
  OpenReaderDto,
  OrderDto,
  ProblemDto,
  RoyaltyPayoutDto,
  ShelfItemDto,
  StartCheckoutDto,
  StorageAuditDto,
  StorageCleanInput,
  StorageCleanResultDto,
  StorageCompareDto,
  StorageDeletePreviewDto,
  StorageDeleteResultDto,
  StorageInventoryPageDto,
  StorageMapDto,
  StorageMovePlanDto,
  StorageTreeDto,
  StorageUnusedDto,
  SupportCreateInput,
  SupportQueryDto,
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
  search = (q: string) =>
    this.request<CatalogueSearchDto>('GET', `/catalogue/search?q=${encodeURIComponent(q)}`);
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
  checkSignInEmail = (email: string) =>
    this.request<{ ok: true; admin: boolean }>('POST', '/auth/check-email', { email });
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
    // The viewer token says which file; the sign-in token proves who is reading it.
    const access = await this.tokenSource();
    const res = await fetch(`${this.base}/reader/pages/${fileId}/${page}`, {
      headers: {
        [VIEWER_TOKEN_HEADER]: viewerToken,
        ...(access ? { authorization: `Bearer ${access}` } : {}),
      },
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

  // Contributions
  contributionStatus = () => this.request<ContributionStatusDto>('GET', '/contributions/me');
  withdrawContribution = (id: string) => this.request<{ ok: true }>('DELETE', `/contributions/${id}`);

  /** Send a JSON `meta` field and files, with upload progress (fetch can't report it, so XHR). */
  private async sendForm<T>(
    path: string,
    meta: unknown,
    files: File[],
    onProgress: (fraction: number) => void = () => {},
  ): Promise<T> {
    const token = await this.tokenSource();
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    for (const f of files) form.append('files', f, f.name);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.base}${path}`);
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () =>
        reject(new ApiError(0, 'NETWORK', 'The upload stopped. Check your connection and try again.'));
      xhr.onabort = () => reject(new ApiError(0, 'NETWORK', 'Upload cancelled.'));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
        const err = (body as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
        reject(new ApiError(xhr.status, err?.code ?? 'INTERNAL', err?.message ?? 'The upload failed.'));
      };
      xhr.send(form);
    });
  }

  /** Save a protected file (it needs the sign-in token, so it can't be a plain link). */
  private async download(path: string, name: string) {
    const token = await this.tokenSource();
    const res = await fetch(`${this.base}${path}`, {
      credentials: 'same-origin',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'INTERNAL', 'Could not download that file.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  uploadContribution = (meta: ContributionMetaInput, files: File[], onProgress: (f: number) => void) =>
    this.sendForm<MyContributionDto>('/contributions', meta, files, onProgress);

  // Help desk
  mySupport = () => this.request<MySupportDto>('GET', '/support');
  askSupport = (meta: SupportCreateInput, files: File[], onProgress?: (f: number) => void) =>
    this.sendForm<SupportQueryDto>('/support', meta, files, onProgress);
  replySupport = (id: string, body: string) =>
    this.request<SupportQueryDto>('POST', `/support/${id}/reply`, { body });
  closeSupport = (id: string) => this.request<SupportQueryDto>('POST', `/support/${id}/close`, {});
  downloadMySupportFile = (id: string, index: number, name: string) =>
    this.download(`/support/${id}/files/${index}`, name);

  // Admin
  adminContributions = (status: 'pending' | 'approved' | 'rejected' | 'all') =>
    this.request<{ open: boolean; items: AdminContributionDto[] }>(
      'GET',
      `/admin/contributions?status=${status}`,
    );
  adminReviewContribution = (id: string, body: ContributionReviewInput) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/review`, body);
  adminCopyContribution = (id: string, folder: string) =>
    this.request<{ copied: string[] }>('POST', `/admin/contributions/${id}/copy`, { folder });
  adminDeleteContribution = (id: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/contributions/${id}`);
  adminSetContributionsOpen = (open: boolean) =>
    this.request<{ open: boolean }>('POST', '/admin/contributions-settings', { open });
  adminBlockContributor = (userId: string, blocked: boolean) =>
    this.request<{ userId: string; blocked: boolean }>('POST', '/admin/contributors/block', {
      userId,
      blocked,
    });
  adminDownloadContribution = (id: string, index: number, name: string) =>
    this.download(`/admin/contributions/${id}/files/${index}`, name);

  adminFileContribution = (
    id: string,
    body: {
      courseId: string;
      unit: string;
      dryRun: boolean;
      files?: { from: string; unit?: string; name?: string; skip?: boolean }[];
    },
  ) => this.request<FilePlanDto>('POST', `/admin/contributions/${id}/file`, body);
  adminCheckContribution = (id: string) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/check`);
  adminCompleteContribution = (id: string, body: { done: boolean; notify: boolean }) =>
    this.request<AdminContributionDto>('POST', `/admin/contributions/${id}/complete`, body);
  adminContributors = () => this.request<ContributorStatsDto[]>('GET', '/admin/contributors');
  adminRewardPaid = (contributionId: string, note: string) =>
    this.request<{ ok: true }>('POST', `/admin/contributions/${contributionId}/reward-paid`, { note });
  adminRecordBonus = (body: { userId: string; year: number; amountRupees: number; note: string }) =>
    this.request<{ ok: true }>('POST', '/admin/royalties/bonus', body);
  adminEarnings = () => this.request<EarningsDto>('GET', '/admin/earnings');
  adminSetRoyalty = (body: { courseId: string; email: string; sharePercent: number }) =>
    this.request<{ ok: true }>('POST', '/admin/royalties', body);
  adminRemoveRoyalty = (courseId: string) =>
    this.request<{ ok: true }>('DELETE', `/admin/royalties/${courseId}`);
  adminRecordPayout = (body: { courseId: string; amountRupees: number; note: string }) =>
    this.request<RoyaltyPayoutDto>('POST', '/admin/royalties/payouts', body);

  adminSupport = (status: 'open' | 'answered' | 'closed' | 'all') =>
    this.request<{ counts: Record<'open' | 'answered' | 'closed', number>; items: AdminSupportQueryDto[] }>(
      'GET',
      `/admin/support?status=${status}`,
    );
  adminReplySupport = (id: string, body: { body: string; close: boolean; notify: boolean }) =>
    this.request<AdminSupportQueryDto>('POST', `/admin/support/${id}/reply`, body);
  adminSetSupportStatus = (id: string, status: 'open' | 'answered' | 'closed') =>
    this.request<{ ok: true }>('POST', `/admin/support/${id}/status`, { status });
  adminDeleteSupport = (id: string) => this.request<{ ok: true }>('DELETE', `/admin/support/${id}`);
  adminDownloadSupportFile = (id: string, index: number, name: string) =>
    this.download(`/admin/support/${id}/files/${index}`, name);

  adminCourses = () => this.request<AdminCourseDto[]>('GET', '/admin/courses');
  adminCourseAccess = (courseId: string) =>
    this.request<AdminCourseAccessDto>('GET', `/admin/access?courseId=${encodeURIComponent(courseId)}`);
  adminChangeAccess = (body: AccessChangeInput) =>
    this.request<AdminCourseAccessDto & { changed: number }>('POST', '/admin/access/change', body);
  adminGrantAccess = (body: AccessGrantInput) =>
    this.request<AdminGrantResultDto>('POST', '/admin/access/grant', body);
  adminSyncHealth = () => this.request<AdminSyncHealthDto>('GET', '/admin/sync-health');
  adminDeleteCourse = (courseId: string, deleteNotes: boolean) =>
    this.request<DeleteCourseResultDto>('POST', `/admin/courses/${courseId}/delete`, { deleteNotes });
  adminProblems = () => this.request<ProblemDto[]>('GET', '/admin/problems');
  adminClearProblems = (fingerprints?: string[]) =>
    this.request<{ cleared: number }>('POST', '/admin/problems/clear', { fingerprints });
  adminStorageTree = () => this.request<StorageTreeDto>('GET', '/admin/storage-tree');
  adminStoragePreview = (path: string) =>
    this.request<StorageDeletePreviewDto>('POST', '/admin/storage-tree/preview', { path });
  adminStorageDelete = (path: string) =>
    this.request<StorageDeleteResultDto>('POST', '/admin/storage-tree/delete', { path, confirm: 'DELETE' });
  adminStorageMove = (body: { paths: string[]; toFolder: string; dryRun: boolean }) =>
    this.request<StorageMovePlanDto>('POST', '/admin/storage-tree/move', body);
  adminStorageRename = (body: { path: string; newName: string; dryRun: boolean }) =>
    this.request<StorageMovePlanDto>('POST', '/admin/storage-tree/rename', body);
  adminAcademic = () => this.request<AcademicDto>('GET', '/admin/academic');
  adminAddYear = (year: number) => this.request<AcademicDto>('POST', '/admin/academic/years', { year });
  adminSetYearVisible = (year: number, visible: boolean) =>
    this.request<AcademicDto>('PUT', `/admin/academic/years/${year}`, { visible });
  adminDeleteYear = (year: number) => this.request<AcademicDto>('DELETE', `/admin/academic/years/${year}`);
  adminSaveBranch = (body: BranchSaveInput) =>
    this.request<AcademicDto>('POST', '/admin/academic/branches', body);
  adminMoveYear = (body: { fromYear: number; toYear: number; branchSlug?: string }) =>
    this.request<AcademicDto & { moved: number }>('POST', '/admin/academic/move-year', body);
  adminStorageMap = () => this.request<StorageMapDto>('GET', '/admin/storage-map');
  adminStorageUnused = () => this.request<StorageUnusedDto>('GET', '/admin/storage-unused');
  adminMoveCourseFolder = (input: MoveCourseFolderInput) =>
    this.request<MoveCourseFolderResultDto>('POST', '/admin/storage-map/move-course', input);
  adminStorageClean = (input: StorageCleanInput) =>
    this.request<StorageCleanResultDto>('POST', '/admin/storage-map/clean', input);
  adminOverview = () => this.request<AdminOverviewDto>('GET', '/admin/overview');
  adminToday = () => this.request<AdminTodayDto>('GET', '/admin/today');
  adminStorageCompare = () => this.request<StorageCompareDto>('GET', '/admin/storage-compare');
  adminConversions = (courseId?: string) =>
    this.request<ConversionBoardDto>(
      'GET',
      `/admin/conversions${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`,
    );
  adminCompareScopes = (scopes: string[]) =>
    this.request<StorageCompareDto>('POST', '/admin/storage-compare', { scopes });
  adminConversionsFor = (scopes: string[]) =>
    this.request<ConversionBoardDto>('POST', '/admin/conversions/query', { scopes });
  adminConvertSelection = (scopes: string[], include: 'waiting' | 'failed' | 'both') =>
    this.request<ConvertScopeResultDto>('POST', '/admin/convert-selection', { scopes, include });
  adminConvert = (input: Partial<ConvertScopeInput> & { courseId: string }) =>
    this.request<ConvertScopeResultDto>('POST', '/admin/convert', input);
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
  adminDeliveries = (id: string) => this.request<DeliveryDto>('GET', `/admin/announcements/${id}/deliveries`);
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
    courseId: string | null;
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

/** True when the current page is part of the admin area. */
function isAdminRoute(): boolean {
  return typeof globalThis.location !== 'undefined' && globalThis.location?.pathname.startsWith('/admin');
}

/** Friendly text for every error code. Admins see full details; students see calm messages. */
export function friendly(error: unknown): string {
  const admin = isAdminRoute();

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_COLLEGE_EMAIL':
        return `Only @${env.domain} accounts can sign in.`;
      case 'RATE_LIMITED':
        // A blocked network is told until when; ordinary speed limits get the calm line.
        if (/network/i.test(error.message)) return error.message;
        return "You're going a bit fast. Take a breath and try again in a minute.";
      case 'NOT_PURCHASED':
        return 'Buy this course to open its files.';
      case 'NOT_READY':
        // Admins get the server's exact reason (which file, what to do); students the calm version.
        if (admin) return error.message;
        return 'This file is still being prepared. Check back in a few minutes.';
      case 'SYNC_FAILED':
        if (admin) return error.message;
        return 'Something went wrong while syncing. Please try again shortly.';
      case 'PAYMENTS_UNAVAILABLE':
        return error.message;
      case 'NETWORK':
        return 'We couldn\u2019t reach Scholars Stack. Check your connection, then try again.';
      case 'ALREADY_OWNED':
        return 'You already own this course. Check your shelf!';
      default:
        // Admins always see the server's real message for debugging.
        if (admin) return error.message;
        // Server-side failures: students get a calm, human sentence.
        if (error.status >= 500)
          return 'The library is having a moment on our side. Nothing is lost. Try again in a minute.';
        // Client errors (400, 403, 404, 409, etc.): show the server's message only if it looks
        // human-readable (no stack traces, no long technical dumps).
        if (
          error.message &&
          error.message.length < 200 &&
          !/\b(stack|trace|error at|ERR_|ECONNREFUSED|ENOTFOUND|uncaught|exception|undefined|null pointer)\b/i.test(
            error.message,
          )
        )
          return error.message;
        return 'Something went wrong. Please try again or contact support if this keeps happening.';
    }
  }
  return 'Something went wrong. Please try again.';
}
