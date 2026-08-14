import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the character-forge remote. Only used when this
 * remote is run on its own (`ng serve character-forge`); in production the
 * hugmesh.net host federates `./routes` (CHARACTER_FORGE_ROUTES)
 * directly — this shell is not loaded. It supplies the skip link + a
 * <main id="main"> landmark so the remote is keyboard-accessible standalone
 * (the a11y contract copied verbatim from the character-studio remote).
 */
@Component({
  selector: 'snap-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
