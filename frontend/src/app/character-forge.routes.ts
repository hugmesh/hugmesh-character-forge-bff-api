import { Routes } from '@angular/router';
import { CharacterForgeComponent } from './character-forge/character-forge.component';

/**
 * The PUBLIC federation surface of this remote — exposed as `./routes` in
 * federation.config.js and consumed by the hugmesh.net host via
 * loadRemoteModule({ remoteName: 'character-forge', exposedModule: './routes' })
 * mounted at /character-forge. Keep the export name CHARACTER_FORGE_ROUTES
 * stable: the host imports it by name.
 */
export const CHARACTER_FORGE_ROUTES: Routes = [
  { path: '', component: CharacterForgeComponent },
];
