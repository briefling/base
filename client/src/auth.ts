// Query of Cognito's /oauth2/authorize (code + PKCE). `lang` makes Managed Login show its pages in the app's language
// (EN/FR toggle, read before the redirect); an unknown value would fall back to the browser's language on Cognito's side.
import type { Lang } from './i18n.ts';

export type AuthorizeArgs = { clientId: string; redirectUri: string; state: string; challenge: string; lang: Lang };

export const authorizeQuery = (a: AuthorizeArgs) => new URLSearchParams({
  response_type: 'code', client_id: a.clientId, redirect_uri: a.redirectUri, scope: 'openid', state: a.state,
  code_challenge_method: 'S256', code_challenge: a.challenge, lang: a.lang,
});
