import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
  if (locals.role === 'guest') {
    redirect(303, `${resolve('/login')}?next=${encodeURIComponent(url.pathname)}`);
  }
  return {};
};
