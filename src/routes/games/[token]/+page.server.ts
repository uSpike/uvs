import { error, fail, redirect } from '@sveltejs/kit';
import { parseGameViewerSettingsJson } from '$lib/game-settings';
import { CatalogRepository } from '$lib/server/catalog';
import { requireGameAccess } from '$lib/server/access';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { ShareLinkRepository } from '$lib/server/share-links';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals, url }) => {
  if (locals.role === 'guest') {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const game = requireGameAccess(locals, params.token);
  const tracking = new GameTrackingRepository().getSnapshot(params.token);
  if (!tracking) error(404, 'Game not found.');
  return {
    role: locals.role,
    tracking,
    shareLinks: new ShareLinkRepository().listForGame(params.token),
    game: {
      token: game.token,
      title: game.title,
      teamName: game.teamName,
      teamSlug: game.teamSlug,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      hasVideo: game.hasVideo,
      settings: game.settings,
      metadataUrl: game.hasVideo ? `/api/games/${game.token}/metadata` : null,
      videoUrl: game.hasVideo ? `/api/games/${game.token}/video` : null,
    },
  };
};

export const actions: Actions = {
  createShareLink: ({ params, locals }) => {
    const game = requireGameAccess(locals, params.token);
    if (!game.hasVideo) return fail(400, { action: 'createShareLink', error: 'A game without video cannot be shared.' });
    new ShareLinkRepository().create(params.token);
    return { action: 'createShareLink', success: true };
  },

  deleteShareLink: async ({ request, params, locals }) => {
    requireGameAccess(locals, params.token);
    const form = await request.formData();
    const shareLinkId = Number(form.get('shareLinkId'));
    if (!Number.isSafeInteger(shareLinkId) || shareLinkId <= 0) {
      return fail(400, { action: 'deleteShareLink', error: 'Share link is invalid.' });
    }
    if (!new ShareLinkRepository().delete(params.token, shareLinkId)) {
      return fail(404, { action: 'deleteShareLink', error: 'Share link was not found.' });
    }
    return { action: 'deleteShareLink', success: true };
  },

  saveSettings: async ({ request, params, locals }) => {
    requireAdmin(locals.role, params.token);
    const form = await request.formData();
    let settings: ReturnType<typeof parseGameViewerSettingsJson>;
    try {
      settings = parseGameViewerSettingsJson(String(form.get('settings') ?? ''));
    } catch (caught) {
      return fail(400, {
        settingsError: caught instanceof Error ? caught.message : 'Settings could not be saved.',
      });
    }
    if (!new CatalogRepository().updateGameSettings(params.token, settings)) {
      error(404, 'Game not found.');
    }
    return { saved: true };
  },

  resetSettings: ({ params, locals }) => {
    requireAdmin(locals.role, params.token);
    if (!new CatalogRepository().resetGameSettings(params.token)) {
      error(404, 'Game not found.');
    }
    return { reset: true };
  },
};

function requireAdmin(role: App.Locals['role'], token: string): void {
  if (role !== 'admin') {
    redirect(303, `/login?next=${encodeURIComponent(`/games/${token}`)}`);
  }
}
