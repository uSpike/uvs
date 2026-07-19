import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
  if (locals.role === 'guest') {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return {};
};
