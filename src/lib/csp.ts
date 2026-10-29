/**
 * Source list for the CSP `frame-ancestors` directive, from CSP_FRAME_ANCESTORS (default `'self'`).
 *
 * CSP keywords must be single-quoted, but .env parsers (Next.js, Docker Compose) strip the quotes
 * from `CSP_FRAME_ANCESTORS='self'`. Unquoted, `self` means "a host named self", which silently
 * blocks every embedder. Bare `self` / `none` keywords are therefore re-quoted here.
 */
export function frameAncestorsSources(raw: string | undefined): string {
  const tokens = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "'self'";
  return tokens
    .map((token) => {
      const keyword = /^'?(self|none)'?$/i.exec(token);
      return keyword ? `'${keyword[1]!.toLowerCase()}'` : token;
    })
    .join(' ');
}
