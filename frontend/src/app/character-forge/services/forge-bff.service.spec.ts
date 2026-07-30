import { TestBed } from '@angular/core/testing';
import { ForgeBffService } from './forge-bff.service';
import { defaultChar3dConfig } from '../models/char3d-config';

/**
 * HTTP contract tests for the §3 API client. The org convention is a
 * hand-written fetch client (no HttpClient — see the character-studio
 * CharacterBffService precedent), so the contract is asserted on a fetch spy
 * (URL, method, headers, credentials, body, status handling) — the same
 * coverage HttpTestingController would give an HttpClient service.
 */
describe('ForgeBffService (BFF HTTP contracts)', () => {
  let svc: ForgeBffService;
  let fetchSpy: jasmine.Spy;

  const okJson = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ForgeBffService);
    fetchSpy = spyOn(window, 'fetch');
  });

  it('list(): GET /bff/character-forge/characters with the bff_ cookie credentials', async () => {
    const rows = [{ id: 'a', name: 'A', active: false, definition: defaultChar3dConfig() }];
    fetchSpy.and.resolveTo(okJson(rows));
    const out = await svc.list();
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
    expect(fetchSpy).toHaveBeenCalledWith('/bff/character-forge/characters', {
      credentials: 'include',
    });
  });

  it('create(): POST JSON {name, definition} and parses the 201 row', async () => {
    const def = defaultChar3dConfig();
    fetchSpy.and.resolveTo(okJson({ id: 'new', name: 'Rex', active: false, definition: def }, 201));
    const created = await svc.create('Rex', def);
    expect(created.id).toBe('new');
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/characters');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Rex', definition: JSON.parse(JSON.stringify(def)) });
  });

  it('get/update/remove hit /characters/{id} with the right verbs (id URL-encoded)', async () => {
    const def = defaultChar3dConfig();
    // fresh Response per call — a Response body can only be consumed once
    fetchSpy.and.callFake(async () => okJson({ id: 'x y', name: 'N', active: false, definition: def }));
    await svc.get('x y');
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/bff/character-forge/characters/x%20y');

    await svc.update('x y', 'N', def);
    let [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/characters/x%20y');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).name).toBe('N');

    fetchSpy.and.resolveTo(new Response(null, { status: 204 }));
    await svc.remove('x y');
    [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/characters/x%20y');
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
  });

  it('setActive(): PUT /characters/{id}/active with no body', async () => {
    fetchSpy.and.resolveTo(new Response(null, { status: 204 }));
    await svc.setActive('abc');
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/characters/abc/active');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeUndefined();
  });

  it('active(): 404 → null (no active character is a normal state, not an error)', async () => {
    fetchSpy.and.resolveTo(new Response('not found', { status: 404 }));
    await expectAsync(svc.active()).toBeResolvedTo(null);
    expect(fetchSpy).toHaveBeenCalledWith('/bff/character-forge/characters/active', {
      credentials: 'include',
    });
  });

  it('active(): 200 parses the row; non-404 errors throw with the status', async () => {
    const def = defaultChar3dConfig();
    fetchSpy.and.resolveTo(okJson({ id: 'a', name: 'A', active: true, definition: def }));
    const active = await svc.active();
    expect(active!.active).toBeTrue();
    fetchSpy.and.resolveTo(new Response('nope', { status: 401 }));
    await expectAsync(svc.active()).toBeRejectedWithError('active 401');
  });

  it('lookup(): POST {subjects:[...]} and returns the configs map', async () => {
    const def = defaultChar3dConfig();
    fetchSpy.and.resolveTo(okJson({ configs: { 'casdoor:u1': { name: 'A', definition: def } } }));
    const out = await svc.lookup(['casdoor:u1', 'casdoor:u2']);
    expect(out.configs['casdoor:u1'].name).toBe('A');
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/characters/lookup');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ subjects: ['casdoor:u1', 'casdoor:u2'] });
  });

  it('map(): POSTs the VnCharacter JSON and returns the mapped Char3DConfig', async () => {
    const def = defaultChar3dConfig();
    fetchSpy.and.resolveTo(okJson(def));
    const vn = {
      schemaVersion: 1,
      packId: 'menagerie-v1',
      name: 'V',
      slots: { head: 'head_wolf_01' },
      palette: {},
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      defaultExpression: 'neutral',
    };
    const out = await svc.map(vn);
    expect(out).toEqual(JSON.parse(JSON.stringify(def)));
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/character-forge/map');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).packId).toBe('menagerie-v1');
  });

  it('non-2xx statuses throw `<op> <status>` errors (401 drives the sign-in degrade)', async () => {
    fetchSpy.and.resolveTo(new Response('no', { status: 401 }));
    await expectAsync(svc.list()).toBeRejectedWithError('list 401');
    await expectAsync(svc.create('n', defaultChar3dConfig())).toBeRejectedWithError('create 401');
    fetchSpy.and.resolveTo(new Response('no', { status: 500 }));
    await expectAsync(svc.setActive('x')).toBeRejectedWithError('setActive 500');
    await expectAsync(svc.remove('x')).toBeRejectedWithError('remove 500');
  });
});
