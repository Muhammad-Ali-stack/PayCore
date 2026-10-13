// @vitest-environment node
/** i18n completeness: every English key exists in Urdu, with the same ICU placeholders. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ur from '../../messages/ur.json';
import enMerchant from '../../messages/en.merchant.json';
import urMerchant from '../../messages/ur.merchant.json';
import enAdmin from '../../messages/en.admin.json';
import urAdmin from '../../messages/ur.admin.json';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Top-level ICU argument names, e.g. {amount}, {count, plural, ...}. */
function placeholders(s: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z0-9_]+)/.exec(s.slice(i));
        if (m) names.add(m[1]!);
      }
      depth++;
    } else if (s[i] === '}') depth--;
  }
  return [...names].sort();
}

const catalogs = [
  ['core', en, ur],
  ['merchant', enMerchant, urMerchant],
  ['admin', enAdmin, urAdmin],
] as const;

// Proper nouns / codes that legitimately stay identical in both languages.
const SAME_OK = /^(PayCore|PKR|AED|USD|IBAN|CVV|MDR|PIN|OTP|CSV|PDF|ID|Visa|JSON|IP|API|URL|%|—|[\d\s.:/%+-]*)$/;

describe.each(catalogs)('%s messages', (_name, enCat, urCat) => {
  const e = flatten(enCat as unknown as Tree);
  const u = flatten(urCat as unknown as Tree);

  it('every en key exists in ur (and no extras)', () => {
    const missing = Object.keys(e).filter((k) => !(k in u));
    const extra = Object.keys(u).filter((k) => !(k in e));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('ICU placeholders match', () => {
    const mismatched = Object.keys(e).filter(
      (k) => k in u && placeholders(e[k]!).join() !== placeholders(u[k]!).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('no empty strings', () => {
    expect(
      Object.entries(u)
        .filter(([, v]) => !v.trim())
        .map(([k]) => k),
    ).toEqual([]);
  });

  it('Urdu is actually translated (mostly Arabic script)', () => {
    const arabicScript = /[؀-ۿ]/;
    const untranslated = Object.keys(e).filter(
      (k) => u[k] === e[k] && !SAME_OK.test(e[k]!) && !arabicScript.test(u[k]!),
    );
    // Allow a handful of brand/technical strings; anything more means a missed translation.
    expect(untranslated.length, untranslated.join(', ')).toBeLessThanOrEqual(12);
  });
});

/**
 * Regression: t.rich('key', { name: () => <El/> }) only works when the message uses a TAG
 * (<name></name>). With a plain {name} placeholder next-intl inserts the function itself and
 * React throws "Functions are not valid as a React child".
 */
describe('rich-text messages', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(join(__dirname, '..'));

  const usages: Array<{ key: string; arg: string; file: string }> = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/t\.rich\(\s*'([^']+)'\s*,\s*\{([^}]*)\}/g)) {
      for (const a of m[2]!.matchAll(/([A-Za-z0-9_]+)\s*:\s*\(/g)) usages.push({ key: m[1]!, arg: a[1]!, file });
    }
  }
  const all = [flatten(en as Tree), flatten(ur as Tree)];

  it('finds the rich-text usages', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('every function argument is a <tag> in both languages, never a {placeholder}', () => {
    const bad: string[] = [];
    for (const u of usages) {
      for (const cat of all) {
        const msgs = Object.entries(cat).filter(([k]) => k === u.key || k.endsWith(`.${u.key}`));
        for (const [k, msg] of msgs) {
          if (!msg.includes(`<${u.arg}>`) || msg.includes(`{${u.arg}}`)) bad.push(`${k} (${u.arg})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
