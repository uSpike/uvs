import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => ({
  role: locals.role,
  teamSlug: locals.teamSlug,
  fullBleed: /^\/(?:games|share)\/[^/]+\/?$/u.test(url.pathname),
  pageScroll: /^\/teams\/[^/]+\/tournaments\/[^/]+\/?$/u.test(url.pathname),
});
