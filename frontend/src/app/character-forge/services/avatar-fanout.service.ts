import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';

/** One platform's outcome. `skipped` is NOT a failure: it means the account
 *  lacks that platform's access role (the proxies gate on ROLE_MATRIX /
 *  ROLE_MASTODON and answer 403), which must never read as "we tried and it
 *  broke" — that would misreport the operator's own mesh. */
export type PlatformOutcome = 'applied' | 'skipped' | 'failed';

export interface PlatformResult {
  platform: string;
  outcome: PlatformOutcome;
  detail?: string;
}

/**
 * Applies ONE image as the user's avatar on every platform that actually has
 * one. Sibling of character-studio-ui's fanout: the 2D rig and this 3D forge
 * produce different pixels but land them through the same three mechanisms,
 * each verified against the running mesh.
 *
 * Auth is the HttpOnly `bff_` cookie on same-origin calls; the browser never
 * holds a homeserver or Mastodon token — the BFF proxies inject those.
 *
 * Platforms deliberately ABSENT, because they have no avatar to set: wiki (no
 * user-presentation layer — only a raw author subject), tube (a personal
 * YouTube mirror with no local creator profiles) and owncast (upstream has
 * instance branding only). Listing them would be a lie.
 */
@Injectable({ providedIn: 'root' })
export class AvatarFanoutService {
  private readonly session = inject(SessionService);
  private readonly base = '/bff/user';

  /** Never throws: the caller renders the per-platform list, so a partial
   *  success stays legible. */
  async applyEverywhere(png: Blob): Promise<PlatformResult[]> {
    return [
      await this.applyToMesh(png),
      await this.applyToMatrix(png),
      await this.applyToMastodon(png),
    ];
  }

  private async applyToMesh(png: Blob): Promise<PlatformResult> {
    try {
      const form = new FormData();
      form.append('file', png, 'avatar.png');
      const res = await fetch(`${this.base}/profile/avatar`, {
        method: 'POST',
        credentials: this.session.credentials,
        body: form,
      });
      if (res.status === 422) {
        return { platform: 'This mesh', outcome: 'failed', detail: 'Blocked by the content policy.' };
      }
      return res.ok
        ? { platform: 'This mesh', outcome: 'applied' }
        : { platform: 'This mesh', outcome: 'failed', detail: `profile avatar ${res.status}` };
    } catch (e) {
      return { platform: 'This mesh', outcome: 'failed', detail: msg(e) };
    }
  }

  /** Upload to the homeserver media repo through the hsproxy, then point the
   *  profile at the returned mxc://. */
  private async applyToMatrix(png: Blob): Promise<PlatformResult> {
    const hs = `${this.base}/matrix`;
    try {
      const who = await fetch(`${hs}/_matrix/client/v3/account/whoami`, {
        credentials: this.session.credentials,
      });
      if (who.status === 401 || who.status === 403) {
        return { platform: 'Matrix', outcome: 'skipped', detail: 'Your account does not have Matrix access.' };
      }
      if (!who.ok) return { platform: 'Matrix', outcome: 'failed', detail: `whoami ${who.status}` };
      const userId = (await who.json()).user_id as string;

      const up = await fetch(`${hs}/_matrix/media/v3/upload`, {
        method: 'POST',
        headers: { 'Content-Type': png.type || 'image/png' },
        credentials: this.session.credentials,
        body: png,
      });
      if (!up.ok) return { platform: 'Matrix', outcome: 'failed', detail: `media upload ${up.status}` };
      const contentUri = (await up.json()).content_uri as string;

      // RAW mxid ('@' and ':' unescaped): the hsproxy re-escapes '%', so a
      // percent-encoded segment arrives double-escaped and misses the route.
      const set = await fetch(`${hs}/_matrix/client/v3/profile/${userId}/avatar_url`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: this.session.credentials,
        body: JSON.stringify({ avatar_url: contentUri }),
      });
      return set.ok
        ? { platform: 'Matrix', outcome: 'applied' }
        : { platform: 'Matrix', outcome: 'failed', detail: `set avatar ${set.status}` };
    } catch (e) {
      return { platform: 'Matrix', outcome: 'failed', detail: msg(e) };
    }
  }

  /** Mastodon + Akkoma (API-compatible): one multipart PATCH. The proxy streams
   *  the body verbatim so the multipart boundary survives. */
  private async applyToMastodon(png: Blob): Promise<PlatformResult> {
    try {
      const form = new FormData();
      form.append('avatar', png, 'avatar.png');
      const res = await fetch(`${this.base}/mastodon/api/v1/accounts/update_credentials`, {
        method: 'PATCH',
        credentials: this.session.credentials,
        body: form,
      });
      if (res.status === 401 || res.status === 403) {
        return { platform: 'Mastodon', outcome: 'skipped', detail: 'Your account does not have Mastodon access.' };
      }
      return res.ok
        ? { platform: 'Mastodon', outcome: 'applied' }
        : { platform: 'Mastodon', outcome: 'failed', detail: `update_credentials ${res.status}` };
    } catch (e) {
      return { platform: 'Mastodon', outcome: 'failed', detail: msg(e) };
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
