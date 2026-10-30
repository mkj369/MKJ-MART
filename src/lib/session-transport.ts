/**
 * Header mirror of the session and guest-bag cookies, for hosted previews whose proxy strips the
 * `Cookie` request header. Observed in the Arena preview: Set-Cookie reaches the browser and is
 * stored, but no request ever carries cookies back, so every request after signing in is anonymous.
 *
 * Off unless SESSION_HEADER_FALLBACK=true AND DEMO_MODE=true. When on:
 *  - responses that set or clear the session / guest-bag cookie also send the value in
 *    `x-mkj-set-session` / `x-mkj-set-cart` ("-" = clear);
 *  - an inline script keeps those values in sessionStorage (this tab only) and adds
 *    `x-mkj-session` / `x-mkj-cart` to same-origin fetches (API calls and Next.js navigations);
 *  - the server reads a header only when the matching cookie is absent.
 * Custom headers are never attached by browsers to cross-site requests, so this adds no CSRF
 * exposure (mutations still pass the same-origin check). The token is readable by page scripts,
 * which is why real stores keep the HttpOnly cookie as their only session transport.
 */
export const SESSION_HEADER = 'x-mkj-session';
export const CART_HEADER = 'x-mkj-cart';
export const SET_SESSION_HEADER = 'x-mkj-set-session';
export const SET_CART_HEADER = 'x-mkj-set-cart';
export const CLEAR_VALUE = '-';
export const STORAGE_KEYS = { session: 'mkj_session_token', cart: 'mkj_cart_id' } as const;

const truthy = (value: string | undefined) => !!value && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

export function headerSessionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return truthy(env.SESSION_HEADER_FALLBACK) && truthy(env.DEMO_MODE);
}

/**
 * Inline script for the document <head> (needs the CSP nonce). It must run before the Next.js
 * runtime makes its first fetch, so it patches window.fetch synchronously.
 */
export function headerSessionScript(): string {
  const cfg = JSON.stringify({
    s: STORAGE_KEYS.session,
    c: STORAGE_KEYS.cart,
    hs: SESSION_HEADER,
    hc: CART_HEADER,
    ss: SET_SESSION_HEADER,
    sc: SET_CART_HEADER,
    clear: CLEAR_VALUE,
  });
  return `(function(){var k=${cfg},st;try{st=window.sessionStorage;st.getItem(k.s)}catch(e){return}
var f=window.fetch.bind(window);
function keep(key,v){if(v===null)return;if(v===k.clear||v==='')st.removeItem(key);else st.setItem(key,v)}
window.fetch=function(input,init){var u;try{u=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href)}catch(e){return f(input,init)}
if(u.origin!==location.origin)return f(input,init);
var h=new Headers((init&&init.headers)||(input instanceof Request?input.headers:undefined)),s=st.getItem(k.s),c=st.getItem(k.c);
if(s&&!h.has(k.hs))h.set(k.hs,s);if(c&&!h.has(k.hc))h.set(k.hc,c);
return f(input,Object.assign({},init,{headers:h})).then(function(r){keep(k.s,r.headers.get(k.ss));keep(k.c,r.headers.get(k.sc));return r})};
window.__mkjHeaderSessions=true})();`;
}
