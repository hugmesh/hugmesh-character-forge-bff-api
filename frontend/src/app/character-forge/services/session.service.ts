import { Injectable } from '@angular/core';

/**
 * BFF authentication seam (pattern copied from hugmesh-character-studio-ui's
 * session.service). The browser never holds a bearer: `/bff/*` calls
 * authenticate via the HttpOnly `bff_` cookie, which the gateway's
 * BffCookieToBearerWebFilter turns into the upstream bearer server-side. The
 * browser's job is simply to SEND the cookie (credentials) on same-origin
 * calls; when the cookie is absent (dev/standalone) BFF calls 401 and the UI
 * degrades, which is correct.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  /** fetch() init that carries the HttpOnly `bff_` cookie on BFF calls. */
  readonly credentials = 'include' as const;
}
