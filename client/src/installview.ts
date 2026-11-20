// Install page of a pinned applet (`#/<space>/applets/<id>` opened in a BROWSER, client/src/appletsview.ts): no launch,
// no runs, only how to put the applet on the home screen, step by step, each step with the menu it happens in redrawn
// (iPhone Safari, Android Chrome). Once installed, the applet's own app opens on the applet itself (installed mode).
// The menus are drawn in HTML/CSS (no image to keep up to date, any language, light and dark): the step's target is
// highlighted, the rest of the menu is there only so the eye finds its place. iOS 26 path (Apple guide « Open as web
// app »): page menu button in the address bar → Share → Add to Home Screen → Open as Web App on → Add.
import type { Key } from './i18n.ts';

type Child = Node | string | null | false | undefined;
export interface InstallKit {
  h(tag: string, attrs?: Record<string, any>, ...kids: Child[]): HTMLElement;
  icon(name: string, size?: number): SVGSVGElement;
  t(key: Key, params?: Record<string, string | number>): string;
}
export type InstallOs = 'ios' | 'android';

export function installPage(k: InstallKit, a: { name: string; iconUrl: string }, os: InstallOs, setOs: (os: InstallOs) => void): HTMLElement {
  const { h, icon, t } = k;
  // one row of a redrawn menu; `on` = the row to tap at this step
  const row = (label: string, ic: string | null, on = false) => h('div', { class: `in-row${on ? ' on' : ''}` }, h('span', {}, label), ic ? icon(ic, 15) : null);
  const tap = () => h('span', { class: 'in-tap', 'aria-hidden': 'true' });
  const step = (n: number, text: string, art: HTMLElement) => h('li', { class: 'in-step', 'data-k': `in-step-${os}-${n}` },
    h('div', { class: 'in-text' }, h('span', { class: 'in-n' }, String(n)), h('p', {}, text)), h('div', { class: 'in-art', 'aria-hidden': 'true' }, art));
  const home = () => h('div', { class: 'in-app' }, h('img', { src: a.iconUrl, alt: '' }), h('span', {}, a.name));

  const ios = [
    // 1. Safari's bottom bar, the page menu button at the left of the address field
    step(1, t('in_i1'), h('div', { class: 'in-bar ios' }, h('span', { class: 'in-round' }, icon('chevronLeft', 15)),
      h('span', { class: 'in-url' }, h('span', { class: 'in-btn on' }, icon('menu', 15), tap()), h('span', { class: 'in-host' }, location.host)),
      h('span', { class: 'in-round' }, icon('copy', 15)))),
    step(2, t('in_i2'), h('div', { class: 'in-menu' }, row(t('in_m_copy'), 'copy'), row(t('in_m_share'), 'share', true), row(t('in_m_bookmark'), 'pin'))),
    step(3, t('in_i3'), h('div', { class: 'in-menu' }, row(t('in_m_copy'), 'copy'), row(t('in_m_reading'), 'list'), row(t('in_m_home'), 'squarePlus', true))),
    step(4, t('in_i4'), h('div', { class: 'in-sheet' },
      h('div', { class: 'in-sheet-head' }, h('span', {}, t('in_m_cancel')), h('b', {}, t('in_m_home')), h('span', { class: 'in-add' }, t('in_m_add'), tap())),
      home(), h('div', { class: 'in-row' }, h('span', {}, t('in_m_webapp')), h('span', { class: 'in-toggle' })))),
  ];
  const android = [
    // 1. Chrome's top bar, the ⋮ menu at the right
    step(1, t('in_a1'), h('div', { class: 'in-bar and' }, h('span', { class: 'in-url' }, h('span', { class: 'in-host' }, location.host)),
      h('span', { class: 'in-btn on' }, icon('moreV', 16), tap()))),
    step(2, t('in_a2'), h('div', { class: 'in-menu' }, row(t('in_m_newtab'), 'plus'), row(t('in_m_bookmark'), 'pin'), row(t('in_m_install'), 'download', true))),
    step(3, t('in_a3'), h('div', { class: 'in-sheet' }, h('b', { class: 'in-sheet-title' }, t('in_m_install_q')), home(),
      h('div', { class: 'in-sheet-acts' }, h('span', {}, t('in_m_cancel')), h('span', { class: 'in-add' }, t('in_m_installbtn'), tap())))),
  ];
  const tab = (x: InstallOs, label: string) => h('button', { type: 'button', class: x === os ? 'on' : '', 'aria-pressed': String(x === os), 'data-k': `in-os-${x}`, onclick: () => setOs(x) }, icon('smartphone', 13), label);
  return h('div', { class: 'in-page', 'data-k': 'in-page' },
    h('header', { class: 'in-head' }, h('img', { class: 'in-icon', src: a.iconUrl, alt: '' }),
      h('h2', {}, t('in_title', { name: a.name })), h('p', {}, t('in_lead'))),
    h('div', { class: 'seg in-seg' }, tab('ios', t('in_ios')), tab('android', t('in_android'))),
    h('ol', { class: 'in-steps' }, ...(os === 'ios' ? ios : android)),
    h('p', { class: 'in-after' }, t(os === 'ios' ? 'in_after_ios' : 'in_after_android')));
}
