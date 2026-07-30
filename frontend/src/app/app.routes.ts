import { Routes } from '@angular/router';
import { CHARACTER_FORGE_ROUTES } from './character-forge.routes';

/** Dev-shell routes: mount the exposed character-forge routes at the root so
 *  the remote is browsable standalone. The host ignores this and loads
 *  `./routes` (CHARACTER_FORGE_ROUTES) directly. */
export const routes: Routes = [{ path: '', children: CHARACTER_FORGE_ROUTES }];
