import { CONTRIBUTION_LIMITS, ContributionMetaBody } from '@ss/contracts';
import { Hono } from 'hono';
import { type AppEnv, requireLive, throttle } from '../helpers';
import { readUploadForm } from '../upload-form';

export const contributionRoutes = new Hono<AppEnv>();

/** What this student may do now, everything they've shared, and what they earn. */
contributionRoutes.get('/contributions/me', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').contributions.status(principal));
});

/**
 * Share notes: a form with `meta` (JSON) and up to five `files`. Signed-in students only,
 * rate limited, size-capped before the body is read, and every file checked by its contents.
 */
contributionRoutes.post('/contributions', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'contribute', principal.userId);
  const { meta, files } = await readUploadForm(c, CONTRIBUTION_LIMITS.bytesPerSubmission);
  const body = ContributionMetaBody.parse(meta);
  return c.json(await c.get('container').contributions.submit(principal, body, files), 201);
});

/** Take back a contribution that hasn't been reviewed. */
contributionRoutes.delete('/contributions/:id', async (c) => {
  const { principal } = await requireLive(c);
  await c.get('container').contributions.withdraw(principal, c.req.param('id'));
  return c.json({ ok: true });
});
