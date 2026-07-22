import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, route }) => ({
  role: locals.role,
  teamSlug: locals.teamSlug,
  fullBleed: route.id === '/games/[token]' || route.id === '/share/[token]',
  pageScroll: route.id === '/teams/[slug]/tournaments/[id]',
});
