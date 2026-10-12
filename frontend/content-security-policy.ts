// The page's Content Security Policy, added to the built index.html (the
// development server needs inline scripts, so it has none). Only this app's
// own scripts, styles, and fonts run; the browser may call and load images
// from exactly the API this build was made for (VITE_API_URL). blob: and
// data: cover QR photos, logo previews, and the labels PDF opened in a tab.
// object-src allows only blob: (PDFs this page built): Chromium opens the
// labels PDF tab either way (checked by the end-to-end tests); browsers that
// treat a PDF tab as plugin content may need it, which was not tested.
export function contentSecurityPolicy(apiUrl: string | undefined): string {
  const api = apiUrl && /^https?:\/\//.test(apiUrl) ? ` ${new URL(apiUrl).origin}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob:${api}`,
    "font-src 'self'",
    `connect-src 'self'${api}`,
    "media-src 'self' blob:",
    'object-src blob:',
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
