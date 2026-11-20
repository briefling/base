// People of a space: invitation by e-mail (admin, gate checked by the router's `admin()`), each person's own
// profile (display name, function, photo) and the admin's edit of an invitee who never signed in. The router keeps the dispatch and the shared member helpers
// (notifyMembers, settingsOf, directory) that the space settings also use.
import { nameKey, normEmail, validAvatar, validName, validRole, type HubFrame, type Principal } from '../../protocol/frames.ts';
import { directory, inviteState, need, notifyMembers, settingsOf, str, type Deps, type Space } from './router.ts';

/**
 * Invitation by e-mail (admin, checked by the caller). The person always arrives as a plain member: trust stays an
 * explicit choice in the Settings. The address is the Cognito user name; an existing account (whatever its user name)
 * is only added, without a mail. The account is created before the space write: if that write keeps failing, the
 * account exists without membership and a new invitation adds it (no second mail).
 */
export async function invite(deps: Deps, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  const email = normEmail(f.email);
  need(!!email, 'bad_email');
  need(!!deps.users, 'invites_off');
  const space = await deps.store.getSpace(f.space);
  need(!!space && !space.archived, 'forbidden');
  const found = await deps.users!.findByEmail(email!);
  need(found.length <= 1, 'ambiguous_email'); // two accounts share this address: the admin picks by hand (script), not the hub
  if (found[0] && space!.members.includes(found[0]))
    return void await reply({ v: 2, type: 'space.invited', client_id: f.client_id, space: settingsOf(space!), person: { id: found[0], name: space!.names?.[found[0]] ?? found[0].slice(0, 6) }, result: 'already' });
  need(space!.members.length < 50, 'too_many_members'); // same bound as space.save
  const { id, created } = found[0] ? { id: found[0], created: false } : await deps.users!.invite(email!);
  const dir = await directory(deps), known = dir.people.get(id), role = dir.roles.get(id);
  const local = email!.split('@')[0];
  const name = known ?? (local[0].toUpperCase() + local.slice(1)).slice(0, 40);
  // Additive write on the current record (another admin tab may have saved meanwhile): a few attempts, then stale.
  for (let i = 0; i < 3; i++) {
    const cur = i === 0 ? space! : await deps.store.getSpace(f.space);
    need(!!cur && !cur.archived, 'forbidden');
    const v = cur!.version ?? 0;
    const already = cur!.members.includes(id);
    const next: Space = already ? cur! : { ...cur!, members: [...cur!.members, id], names: { ...(cur!.names ?? {}), [id]: cur!.names?.[id] ?? name },
      ...(role ? { roles: { ...(cur!.roles ?? {}), [id]: cur!.roles?.[id] || role } } : {}), version: v + 1 };
    if (already || await deps.store.updateSpace(next, v)) {
      // a fresh account has not signed in yet; an existing one may not have either (invited earlier, elsewhere)
      const since = created ? deps.now() : (await deps.users!.pending()).get(id);
      await reply({ v: 2, type: 'space.invited', client_id: f.client_id, space: settingsOf(next),
        person: { id, name: next.names?.[id] ?? name, ...(since !== undefined ? { invite: inviteState(deps, since) } : {}) },
        result: already ? 'already' : created ? 'invited' : 'added' });
      if (!already) await notifyMembers(deps, next); // connected members learn the newcomer's name (else « Member 1a2b3c »)
      return;
    }
  }
  need(false, 'stale');
}

// ---------------------------------------------------------------- profile
// Each person sets their own display name, written in every space they are a member of (names are per space: the
// admin's Settings and invitations write them too). Safeguard: nobody sharing a space with them, human or agent, may
// already have that name (ignoring case, accents, spaces, dots): otherwise a member could pass for someone else.
// Agents act on trusted ids, never on names: a name is only what humans read.
export async function profile(deps: Deps, who: Principal, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64));
  const avatar = f.avatar === undefined ? undefined : validAvatar(f.avatar); // missing = unchanged, '' = removed
  const { name, role, mine } = await checked(deps, who.id, f);
  need(avatar !== null, 'bad_avatar');
  const r = await writeProfile(deps, who.id, mine, name, role, avatar ?? undefined);
  await reply({ v: 2, type: 'profile.saved', client_id: f.client_id, name, role: r });
}

/**
 * Global admin (checked by the caller), for a person who never signed in: an invitee shows under a name taken from
 * their address until they pick theirs. Past their first sign-in it is their profile (`forbidden`): the admin would
 * overwrite the name they chose. member.profile = their name and function, with profile.save's checks; member.reinvite
 * = a new temporary password mailed by Cognito (the old one expires after 7 days).
 */
export async function member(deps: Deps, f: any, reply: (f: HubFrame) => Promise<boolean>) {
  need(str(f.client_id, 64) && str(f.person, 64));
  need(!!deps.users, 'invites_off');
  const id: string = f.person;
  need((await deps.users!.pending()).has(id), 'forbidden');
  let result: 'saved' | 'reinvited' = 'saved';
  if (f.type === 'member.reinvite') {
    need(await deps.users!.resend(id), 'forbidden'); // signed in meanwhile
    result = 'reinvited';
  } else {
    const { name, role, mine } = await checked(deps, id, f);
    await writeProfile(deps, id, mine, name, role);
  }
  const d = await directory(deps), since = (await deps.users!.pending()).get(id), role = d.roles.get(id);
  await reply({ v: 2, type: 'member.saved', client_id: f.client_id, result,
    person: { id, name: d.people.get(id) ?? id.slice(0, 6), ...(role ? { role } : {}), ...(since !== undefined ? { invite: inviteState(deps, since) } : {}) } });
}

/** Name and function of a profile frame, validated against the spaces of the person `id` (bad_name, bad_role, forbidden, name_taken). */
async function checked(deps: Deps, id: string, f: any) {
  const name = validName(f.name);
  need(!!name, 'bad_name');
  const role = f.role === undefined ? undefined : validRole(f.role); // missing (older tab) = unchanged
  need(role !== null, 'bad_role');
  const mine = (await deps.store.listSpaces()).filter(s => s.members.includes(id));
  need(mine.length > 0, 'forbidden');
  const k = nameKey(name!);
  const taken = mine.some(s => s.members.some(m => m !== id && !!s.names?.[m] && nameKey(s.names[m]) === k)
    || (s.agents ?? [s.defaultAgent]).some(a => nameKey(a) === k));
  need(!taken, 'name_taken');
  return { name: name!, role: role ?? undefined, mine };
}

/** Writes the person's name, function and photo in each of their spaces and tells the connected members; returns the function kept. */
async function writeProfile(deps: Deps, id: string, mine: Space[], name: string, role: string | undefined, avatar?: string) {
  // One function for the person, the same in every space: the first one found when unchanged.
  const r = role ?? mine.map(s => s.roles?.[id]).find(x => x) ?? '';
  for (const s of mine) {
    if (s.names?.[id] === name && (s.roles?.[id] ?? '') === r && (avatar === undefined || (s.avatars?.[id] ?? '') === avatar)) continue;
    if (!await deps.store.setProfile(s.id, id, name, r, avatar)) continue; // removed from it meanwhile
    const { [id]: _, ...others } = s.roles ?? {};
    const { [id]: _a, ...otherAvatars } = s.avatars ?? {};
    const avatars = avatar === undefined ? s.avatars : avatar ? { ...otherAvatars, [id]: avatar } : otherAvatars;
    if (!s.archived) await notifyMembers(deps, { ...s, names: { ...(s.names ?? {}), [id]: name }, roles: r ? { ...others, [id]: r } : others, avatars });
  }
  return r;
}
