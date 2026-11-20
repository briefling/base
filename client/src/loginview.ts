// In-app sign-in screen (Cognito API in client/src/login.ts) and the profile dialog (own name, function, photo; the
// global admin reuses it for an invitee who never signed in: name and function only, plus a new temporary password).
// Their own file since the modules refactor: main.ts keeps the tokens, the socket and `render()`, which shows
// `loginView()` instead of the app while `signingIn()`. Built on first use (main.ts `lg()`).
import { MAX_NAME, validName, MAX_ROLE, validRole, type DirectoryPerson } from '../../protocol/frames.ts';
import type { Key } from './i18n.ts';
import { signIn, newPassword, forgot, confirmForgot, normUser, pwProblem, PW_MIN, type Idp, type Tokens } from './login.ts';
import { newBoot, type Boot } from './boot.ts';
import type { UiKit } from './modules.ts';

/** The part of main.ts' app state sign-in and profile read or write. */
export interface LoginShared { me: string; drawer: boolean }
export interface LoginDeps {
  idp: Idp;
  rand(): string;
  /** The Cognito Managed Login page (fallback link of the sign-in screen). */
  hostedLogin(): Promise<never>;
  saveTokens(t: Tokens): void;
  /** Boot state (client/src/boot.ts): the splash and its timeouts. */
  B: Boot;
  /** Stops the boot timer (the sign-in screen replaces the splash). */
  stopBoot(): void;
  themeSwitch(): HTMLElement;
  langBtn(): HTMLElement;
  iconBtn(name: string, text: string, onclick: (e: Event) => void, extra?: Record<string, any>): HTMLElement;
  withRole(name: string, role: string): string;
  personRole(id: string, space?: string): string;
  avatarField(src: string, name: string, kind: 'human' | 'agent', k: string, pick: (f: File | undefined) => void, remove: () => void, disabled?: boolean): HTMLElement;
  pickAvatar(file: File, ok: (src: string) => void, ko: (err: string) => void): Promise<void>;
  /** Standalone server with OIDC: « reinvite » extends the invitation (no password, no mail). */
  oidc?: boolean;
}

export function loginModule(k: UiKit, S: LoginShared, d: LoginDeps) {
  const { h, icon, t, render, errText, send, personAvatar, personName } = k;
  const { idp, rand, hostedLogin, saveTokens, B, stopBoot, themeSwitch, langBtn, iconBtn, personRole, avatarField, pickAvatar, withRole } = d;
  // Sign-in screen: shown instead of the app (render()) while `L` is set, i.e. no valid session. Steps: sign in, choose a
  // password (invitation: temporary password), forgot password (code by mail), new password with that code.
  type LoginStep = 'signin' | 'newpw' | 'forgot' | 'reset';
  type LoginForm = { step: LoginStep; user: string; pw: string; pw2: string; code: string; session: string; busy: boolean; err: Key | ''; note: { k: Key; dest?: string } | null };
  const loginForm = (user = ''): LoginForm => ({ step: 'signin', user, pw: '', pw2: '', code: '', session: '', busy: false, err: '', note: null });
  let L: LoginForm | null = null, loginWait: Promise<string> | null = null, loginDone: (tok: string) => void = () => {};
  function login(): Promise<string> {
    if (loginWait) return loginWait; // a reconnection while the screen is up waits for the same sign-in
    L = loginForm();
    stopBoot(); document.getElementById('splash')?.classList.add('hide');
    render(); focusLogin();
    return loginWait = new Promise(res => { loginDone = res; });
  }
  function signedIn(tk: Tokens) {
    saveTokens(tk); L = null; loginWait = null;
    // First load: the splash comes back while the hub answers, its timeouts counted from now, not from the page load.
    if (!B.out) { Object.assign(B, newBoot(Date.now())); document.getElementById('splash')?.classList.remove('hide'); }
    render(); loginDone(tk.access);
  }
  const focusLogin = () => window.setTimeout(() => (document.querySelector('.login-card input:not(.vh)') as HTMLInputElement | null)?.focus());
  async function loginSubmit(e: Event) {
    e.preventDefault();
    const f = L; if (!f || f.busy) return;
    const shown = { signin: [f.user, f.pw], newpw: [f.pw, f.pw2], forgot: [f.user], reset: [f.code, f.pw, f.pw2] }[f.step];
    if (shown.some(v => !v.trim())) { f.err = 'login_empty'; render(); return; }
    if (f.step === 'newpw' || f.step === 'reset') { const p = pwProblem(f.pw, f.pw2); if (p) { f.err = p; render(); return; } }
    const user = normUser(f.user), was = f.step;
    f.busy = true; f.err = ''; render();
    if (f.step === 'signin') {
      const r = await signIn(idp, user, f.pw, Date.now());
      if (r.kind === 'tokens') return signedIn(r.tokens);
      if (r.kind === 'new_password') Object.assign(f, { step: 'newpw', session: r.session, user: r.username, pw: '', pw2: '', note: null });
      else if (r.kind === 'reset') Object.assign(f, { step: 'reset', user, pw: '', pw2: '', code: '', note: { k: 'login_reset_required' } });
      else f.err = r.err;
    } else if (f.step === 'newpw') {
      const r = await newPassword(idp, f.session, f.user, f.pw, Date.now());
      if ('tokens' in r) return signedIn(r.tokens);
      f.err = r.err;
      if (r.err === 'login_session_expired') Object.assign(f, { step: 'signin', pw: '', pw2: '', session: '' });
    } else if (f.step === 'forgot') {
      const r = await forgot(idp, user);
      if ('dest' in r) Object.assign(f, { step: 'reset', user, code: '', pw: '', pw2: '', note: r.dest ? { k: 'login_code_sent', dest: r.dest } : { k: 'login_code_sent_any' } });
      else f.err = r.err;
    } else {
      const r = await confirmForgot(idp, user, f.code, f.pw);
      if ('ok' in r) Object.assign(f, { step: 'signin', pw: '', pw2: '', code: '', note: { k: 'login_pw_changed' } });
      else f.err = r.err;
    }
    f.busy = false; render();
    if (f.step !== was) focusLogin();
  }
  async function loginResend() {
    const f = L; if (!f || f.busy) return;
    f.busy = true; f.err = ''; render();
    const r = await forgot(idp, normUser(f.user));
    if ('dest' in r) f.note = r.dest ? { k: 'login_code_sent', dest: r.dest } : { k: 'login_code_sent_any' }; else f.err = r.err;
    f.busy = false; render();
  }
  function loginGo(step: LoginStep) { if (!L || L.busy) return; L = { ...loginForm(L.user), step }; render(); focusLogin(); }
  function loginView() {
    const f = L!;
    const field = (k: 'user' | 'pw' | 'pw2' | 'code', label: string, type: string, autocomplete: string, extra: Record<string, any> = {}) => h('div', { class: 'sp-field' },
      h('label', { class: 'label', for: `lg-${k}` }, label),
      h('input', { id: `lg-${k}`, name: k, type, autocomplete, value: f[k], required: true, autocapitalize: 'none', spellcheck: 'false', disabled: f.busy,
        oninput: (e: Event) => { f[k] = (e.target as HTMLInputElement).value; if (f.err) { f.err = ''; render(); } }, ...extra }));
    // Password managers file a new password under the user name: give it to them on the steps that don't show the field.
    const hiddenUser = h('input', { class: 'vh', type: 'text', name: 'user', autocomplete: 'username', value: f.user, tabindex: '-1', 'aria-hidden': 'true', readonly: true });
    const link = (text: string, onclick: () => void) => h('button', { class: 'linkbtn', type: 'button', disabled: f.busy, onclick }, text);
    const newPw = [field('pw', t('login_new_pw'), 'password', 'new-password'), field('pw2', t('login_new_again'), 'password', 'new-password'),
      h('div', { class: 'sp-hint' }, t('login_pw_rule', { n: PW_MIN }))];
    const step = {
      signin: { title: t('login_title'), hint: '', go: 'login_submit' as Key, fields: [field('user', t('login_user'), 'text', 'username', { inputmode: 'email' }), field('pw', t('login_password'), 'password', 'current-password')],
        links: [link(t('login_forgot_link'), () => loginGo('forgot')), link(t('login_hosted'), () => { hostedLogin(); })] },
      newpw: { title: t('login_new_title'), hint: t('login_new_hint'), go: 'login_new_submit' as Key, fields: [hiddenUser, ...newPw],
        links: [link(t('login_back'), () => loginGo('signin'))] },
      forgot: { title: t('login_forgot_title'), hint: t('login_forgot_hint'), go: 'login_send_code' as Key, fields: [field('user', t('login_user'), 'text', 'username', { inputmode: 'email' })],
        links: [link(t('login_back'), () => loginGo('signin'))] },
      reset: { title: t('login_reset_title'), hint: '', go: 'login_reset_submit' as Key, fields: [hiddenUser, field('code', t('login_code'), 'text', 'one-time-code', { inputmode: 'numeric', maxlength: 12 }), ...newPw],
        links: [link(t('login_resend'), loginResend), link(t('login_back'), () => loginGo('signin'))] },
    }[f.step];
    const cup = icon('coffee', 44); cup.setAttribute('stroke-width', '1.3');
    return h('div', { class: 'login', 'data-k': 'login' },
      h('div', { class: 'login-top' }, themeSwitch(), langBtn()),
      // One form per step (key): the browser and password managers see a fresh form, no value carried across steps.
      // novalidate: our own messages (the app's look), not the browser's bubbles.
      h('form', { class: 'login-card', 'data-k': `lg-${f.step}`, novalidate: true, onsubmit: loginSubmit },
        h('div', { class: 'login-brand', 'aria-hidden': 'true' }, cup as unknown as Node, h('div', { class: 'word' }, 'brief', h('span', {}, 'ling'))),
        h('h1', {}, step.title),
        step.hint ? h('p', { class: 'sp-hint' }, step.hint) : null,
        f.note ? h('div', { class: 'login-note', role: 'status' }, t(f.note.k, { dest: f.note.dest ?? '' })) : null,
        ...step.fields,
        f.err ? h('div', { class: 'err login-err', role: 'alert' }, t(f.err, { n: PW_MIN })) : null,
        h('button', { class: 'btn pri big login-go', type: 'submit', disabled: f.busy }, f.busy ? t('login_wait') : t(step.go)),
        h('div', { class: 'login-links' }, ...step.links)));
  }
  // Profile: the person's own display name and function, shown to the others in every space they share (profile.save,
  // checked by the hub). The function is display only and never reaches an agent.
  // open dialog (avatar: '' = initial); who: the invitee the admin edits (member.profile), absent for one's own profile
  let profile: { name: string; role: string; avatar: string; cid: string; err: string; who?: DirectoryPerson; resending?: boolean } | null = null;
  function profileEl() {
    const mine = personName(S.me), role = personRole(S.me);
    return h('div', { class: 'me-row' },
      h('div', { class: 'me-who' }, h('span', { class: 'me-name', title: withRole(mine ?? '', role) }, mine ?? '…'), role ? h('span', { class: 'me-role' }, role) : null),
      // Pencil shown on hover of the row (always on touch screens and on keyboard focus), Blair's request: a link was too heavy.
      iconBtn('pencil', t('profile_edit'), openProfile, { class: 'btn ic me-edit', disabled: !mine }));
  }
  function openProfile() {
    profile = { name: personName(S.me) ?? '', role: personRole(S.me), avatar: personAvatar(S.me, 'human'), cid: '', err: '' }; S.drawer = false; render();
    (document.getElementById('me-input') as HTMLInputElement | null)?.select();
  }
  function openMember(who: DirectoryPerson) {
    profile = { name: who.name, role: who.role ?? '', avatar: '', cid: '', err: '', who }; render();
    (document.getElementById('me-input') as HTMLInputElement | null)?.select();
  }
  function closeProfile() { profile = null; render(); }
  function profileDialog() {
    const p = profile!;
    const save = () => {
      const name = validName(p.name), role = validRole(p.role);
      if (!name) { p.err = t('err_bad_name'); render(); return; }
      if (role === null) { p.err = t('err_bad_role'); render(); return; }
      if (p.who) { // an invitee's profile, edited by the admin: no photo
        if (name === p.who.name && role === (p.who.role ?? '')) { closeProfile(); return; }
        const cid = rand().slice(0, 20);
        if (send({ type: 'member.profile', client_id: cid, person: p.who.id, name, role })) { p.cid = cid; p.err = ''; render(); }
        return;
      }
      const avatarChanged = p.avatar !== personAvatar(S.me, 'human');
      if (name === personName(S.me) && role === personRole(S.me) && !avatarChanged) { closeProfile(); return; }
      const cid = rand().slice(0, 20);
      if (send({ type: 'profile.save', client_id: cid, name, role, ...(avatarChanged ? { avatar: p.avatar } : {}) })) { p.cid = cid; p.err = ''; render(); }
    };
    const pick = (file: File | undefined) => { if (file) void pickAvatar(file, src => { if (profile === p) { p.avatar = src; p.err = ''; } }, err => { if (profile === p) p.err = err; }); };
    const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); closeProfile(); } };
    const input = (id: string, value: string, max: number, label: string, ph: string, set: (v: string) => void) => h('div', { class: 'sp-field' },
      h('label', { class: 'label', for: id }, label),
      h('input', { id, value, maxlength: max, placeholder: ph, autocomplete: 'off', onkeydown: keys,
        oninput: (e: Event) => { set((e.target as HTMLInputElement).value); p.err = ''; render(); } }));
    const preview = validName(p.name);
    const resend = () => { const cid = rand().slice(0, 20); if (send({ type: 'member.reinvite', client_id: cid, person: p.who!.id })) { p.cid = cid; p.resending = true; p.err = ''; render(); } };
    return h('div', { class: 'pal-wrap', 'data-k': p.who ? 'member-profile' : 'profile' },
      h('div', { class: 'scrim', onclick: closeProfile }),
      h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
        h('h2', { id: 'dlg-t' }, p.who ? t('member_dlg', { name: p.who.name }) : t('profile_dlg')),
        p.who ? null : avatarField(p.avatar, validName(p.name) ?? '?', 'human', 'me-avatar', pick, () => { p.avatar = ''; p.err = ''; render(); }),
        input('me-input', p.name, MAX_NAME, t('name'), '', v => { p.name = v; }),
        input('me-role', p.role, MAX_ROLE, t('role'), t('role_ph'), v => { p.role = v; }),
        h('div', { class: 'dlg-prev' }, h('span', { class: 'label' }, t('profile_preview')),
          h('span', { class: 'dlg-who' }, h('b', {}, preview ?? '…'), validRole(p.role) ? h('span', { class: 'me-role' }, ` · ${validRole(p.role)}`) : null)),
        h('div', { class: 'sp-hint' }, p.who ? t('member_hint') : t('profile_hint')),
        p.err ? h('div', { class: 'err dlg-err', role: 'alert' }, p.err) : null,
        h('div', { class: 'dlg-btns' },
          p.who ? h('button', { class: 'btn dlg-alt', 'data-k': 'member-reinvite', title: t(d.oidc ? 'oidc_member_reinvite_title' : 'member_reinvite_title'), disabled: !!p.cid, onclick: resend }, p.resending ? t('member_reinviting') : t(d.oidc ? 'oidc_member_reinvite' : 'member_reinvite')) : null,
          h('button', { class: 'btn ghost', onclick: closeProfile }, t('cancel')),
          h('button', { class: 'btn pri', disabled: !!p.cid, onclick: save }, p.cid && !p.resending ? t('saving') : t('save')))));
  }
  return { login, loginView, signingIn: () => L !== null, profileEl, closeProfile, profileDialog, profileOn: () => profile !== null, openMember, profileSaved: (cid: string) => { if (profile?.cid === cid) profile = null; }, profileRefused: (cid: string, code: string) => { if (!profile || profile.cid !== cid) return false; profile.cid = ''; profile.resending = false; profile.err = errText(code); return true; } };
}
