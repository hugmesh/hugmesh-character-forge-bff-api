import { Injectable, inject } from '@angular/core';
import { SessionService } from './session.service';
import { Char3dConfig } from '../models/char3d-config';
import { VnCharacter } from '../models/vn-character';

/**
 * One saved forge character as the BFF returns it (§3 wire shape). The owner
 * subject/domain never cross the wire — ownership is always derived server-side
 * from the JWT (foreign ids read as 404, never 403).
 */
export interface ForgeCharacter {
  id: string;
  name: string;
  active: boolean;
  definition: Char3dConfig;
  createdAt?: string;
  updatedAt?: string;
}

/** `POST /characters/lookup` response — subject → active config (name + definition). */
export interface ForgeLookupResult {
  configs: Record<string, { name: string; definition: Char3dConfig }>;
}

/**
 * Hand-written fetch client for the character-forge BFF (the org convention;
 * no HttpClient) — the thin typed client for the DESIGN §3 API at
 * `/bff/character-forge`. Authenticates via the HttpOnly `bff_` cookie
 * ({@link SessionService} credentials) — no browser bearer. Server-side
 * validation is authoritative (clamps/enum checks/16KB cap); the client mirror
 * lives in models/char3d-config.ts.
 */
@Injectable({ providedIn: 'root' })
export class ForgeBffService {
  private readonly session = inject(SessionService);
  private readonly base = '/bff/character-forge';

  /** `GET /characters` — list my saved characters (server caps the list at 32). */
  async list(): Promise<ForgeCharacter[]> {
    const res = await fetch(`${this.base}/characters`, {
      credentials: this.session.credentials,
    });
    if (!res.ok) {
      throw new Error(`list ${res.status}`);
    }
    return (await res.json()) as ForgeCharacter[];
  }

  /** `POST /characters` — create; 201 with the stored (server-clamped) row. */
  async create(name: string, definition: Char3dConfig): Promise<ForgeCharacter> {
    const res = await fetch(`${this.base}/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: this.session.credentials,
      body: JSON.stringify({ name, definition }),
    });
    if (!res.ok) {
      throw new Error(`create ${res.status}`);
    }
    return (await res.json()) as ForgeCharacter;
  }

  /** `GET /characters/{id}` — owner-only; a foreign id reads as 404. */
  async get(id: string): Promise<ForgeCharacter> {
    const res = await fetch(`${this.base}/characters/${encodeURIComponent(id)}`, {
      credentials: this.session.credentials,
    });
    if (!res.ok) {
      throw new Error(`get ${res.status}`);
    }
    return (await res.json()) as ForgeCharacter;
  }

  /** `PUT /characters/{id}` — owner-only update (name + definition). */
  async update(id: string, name: string, definition: Char3dConfig): Promise<ForgeCharacter> {
    const res = await fetch(`${this.base}/characters/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: this.session.credentials,
      body: JSON.stringify({ name, definition }),
    });
    if (!res.ok) {
      throw new Error(`update ${res.status}`);
    }
    return (await res.json()) as ForgeCharacter;
  }

  /** `DELETE /characters/{id}` — owner-only. */
  async remove(id: string): Promise<void> {
    const res = await fetch(`${this.base}/characters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: this.session.credentials,
    });
    if (!res.ok) {
      throw new Error(`remove ${res.status}`);
    }
  }

  /** `PUT /characters/{id}/active` — mark active (single active per owner). */
  async setActive(id: string): Promise<void> {
    const res = await fetch(`${this.base}/characters/${encodeURIComponent(id)}/active`, {
      method: 'PUT',
      credentials: this.session.credentials,
    });
    if (!res.ok) {
      throw new Error(`setActive ${res.status}`);
    }
  }

  /** `GET /characters/active` — my active character, or null when none (404). */
  async active(): Promise<ForgeCharacter | null> {
    const res = await fetch(`${this.base}/characters/active`, {
      credentials: this.session.credentials,
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`active ${res.status}`);
    }
    return (await res.json()) as ForgeCharacter;
  }

  /** `POST /characters/lookup` — {subjects:[1..50]} → active configs by subject. */
  async lookup(subjects: string[]): Promise<ForgeLookupResult> {
    const res = await fetch(`${this.base}/characters/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: this.session.credentials,
      body: JSON.stringify({ subjects }),
    });
    if (!res.ok) {
      throw new Error(`lookup ${res.status}`);
    }
    return (await res.json()) as ForgeLookupResult;
  }

  /**
   * `POST /map` — VnCharacter JSON in → Char3DConfig out (the server-side pure
   * mapping function; util/map-vn.ts is its client mirror for offline preview).
   */
  async map(vn: VnCharacter): Promise<Char3dConfig> {
    const res = await fetch(`${this.base}/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: this.session.credentials,
      body: JSON.stringify(vn),
    });
    if (!res.ok) {
      throw new Error(`map ${res.status}`);
    }
    return (await res.json()) as Char3dConfig;
  }
}
