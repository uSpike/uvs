import type { Handle } from '@sveltejs/kit';
import { sessionFromCookies } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const session = sessionFromCookies(event.cookies);
  event.locals.role = session.role;
  event.locals.teamId = session.teamId;
  event.locals.teamSlug = session.teamSlug;
  return resolve(event);
};
