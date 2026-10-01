// Enkripsi secret GitHub Actions (libsodium crypto_box_seal) — murni JS, jalan di Worker.
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';

const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Sealed box: ephemeral_pk || box(msg, nonce = blake2b(epk || pk, 24), pk, esk). */
export function sealSecret(publicKeyB64, value) {
  const pk = unb64(publicKeyB64);
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64);
  nonceInput.set(eph.publicKey, 0);
  nonceInput.set(pk, 32);
  const nonce = blake2b(nonceInput, undefined, 24);
  const boxed = nacl.box(new TextEncoder().encode(value), nonce, pk, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return b64(out);
}
