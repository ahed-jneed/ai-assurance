# Third-party notices

The project as a whole is licensed under Apache-2.0 ([LICENSE](LICENSE)). The
files below are third-party material that is vendored into this repository. They
keep their original licence, and each licence text is kept next to the files.

| Material | Location | Licence | Licence text |
|---|---|---|---|
| shadcn/ui Tailwind theme and components (modified) | `site-app/vendor/shadcn-tailwind-4.13.0.css`, `site-app/components/ui/`, `site-app/hooks/use-mobile.ts` | MIT, © 2023 shadcn | [`site-app/vendor/shadcn-tailwind-4.13.0.LICENSE.md`](site-app/vendor/shadcn-tailwind-4.13.0.LICENSE.md) |
| `@openai/sites-vite-plugin` 0.2.0 (modified development-server plugin) | `site-app/build/sites-vite-plugin.ts` | MIT, © 2026 OpenAI | [`site-app/build/sites-vite-plugin.LICENSE`](site-app/build/sites-vite-plugin.LICENSE) |
| Next.js starter icons | `site-app/public/file.svg`, `globe.svg`, `window.svg` | MIT, © Vercel, Inc. | <https://github.com/vercel/next.js/blob/canary/license.md> |

## Dependencies

npm and PyPI dependencies are not redistributed in this repository. Their
licences apply when you install them (see `site-app/package-lock.json` and
`engine/requirements*.txt`). At the time of writing, no production dependency
uses a copyleft licence other than the optional, dynamically linked
`@img/sharp-libvips-*` binaries (LGPL-3.0-or-later).

## Regulatory and standards content

Regulatory texts and standards are cited, not reproduced. Each criteria pack in
`templates/criteria/` records the source licence of the framework it maps in its
`licence` block:

- EU legal texts are reused under Commission Decision 2011/833/EU, with acknowledgement.
- NIST publications are in the public domain.
- MITRE ATLAS (Apache-2.0) and OWASP (CC BY-SA 4.0) entries store only identifiers and names, with attribution.
- ISO/IEC and CEN/CENELEC standards are copyrighted. The packs reference them only by clause number, with titles written by this project. No standard text is reproduced.
