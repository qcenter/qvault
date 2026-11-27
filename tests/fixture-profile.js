import {createPasskeyProfile,toBase64} from '../src/profile-crypto.js';
// Test fixture: a profile whose passkey secret is derived from a label, so a test can name its secret the way a person names a passkey.
// The derivation is a plain mixing function, good enough to give different labels different secrets. It is used by tests only.
export function fixtureSecret(label){const out=new Uint8Array(32);let h=2166136261;for(let round=0;round<4;round++)for(const c of String(label)){h^=c.charCodeAt(0)+round;h=Math.imul(h,16777619)>>>0;out[(h>>>8)%32]^=h&255;out[(h>>>16)%32]^=(h>>>24)&255}for(let i=0;i<32;i++){h^=out[i]+i;h=Math.imul(h,16777619)>>>0;out[i]^=h&255}return {prf:out}}
// For runtime.command({action:'unlock',...fixtureUnlock(label)}).
export const fixtureUnlock=label=>({prf:toBase64(fixtureSecret(label).prf)});
export async function fixtureProfile(label){return createPasskeyProfile({prf:fixtureSecret(label).prf,credentialId:toBase64(crypto.getRandomValues(new Uint8Array(20))),prfSalt:toBase64(crypto.getRandomValues(new Uint8Array(32)))})}
// The profile key ("handle") for sealProfile, in place of a key made from a typed password.
export async function fixtureKey(label){return (await fixtureProfile(label)).handle}
