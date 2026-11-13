#!/usr/bin/env python3
"""Build data/words.js and data/forms.json from the DSL lemma frequency list,
English Wiktionary (for forms, gender, word class) and hand-written German glosses.

Usage:
  python3 -I tools/build-words.py <lemma-30k-2017.txt> <kaikki-Danish.jsonl.gz> [out.js] [--worklist]

--worklist prints the words still without a German gloss as
  word<TAB>pos<TAB>English glosses
so they can be added to tools/glosses-de.tsv.

Sources (download them yourself, they are not in the repo):
  - lemma-30k-2017.txt: "De hyppigste ord i dansk" (30,000 most frequent lemmas,
    Det Danske Sprog- og Litteraturselskab, DSL Åben Licens),
    https://korpus.dsl.dk/resources/details/freq-lemmas.html
    -> https://korpus.dsl.dk/download/lemma-10k.zip (the zip holds the 30k list)
  - kaikki.org-dictionary-Danish.jsonl.gz: English Wiktionary extract (CC BY-SA),
    https://kaikki.org/dictionary/Danish/kaikki.org-dictionary-Danish.jsonl.gz

The DSL list has no CEFR levels; the levels here are frequency bands (LEVEL_SIZES).
Homographs with several word classes (e.g. "at" conjunction / infinitive marker)
become one word with the word class of the most frequent reading.

Word shape: {id, l: 'A1'..'C1', w: Danish lemma, a: 'en'/'et' (nouns),
             r: forms summary (e.g. "huset · huse", "går · gik · gået"),
             e: German gloss, p: word class code, f: frequency rank}
Empty fields are left out. Ids 1..N follow frequency rank.
"""
import gzip, json, re, sys, unicodedata

LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']
LEVEL_SIZES = [500, 500, 1000, 1500, 1500]   # 5000 words in total

# DSL word class -> (short code, kaikki pos names that match it)
POS_MAP = {
    'NC': ('n', ['noun']),
    'V': ('v', ['verb']),
    'A': ('adj', ['adj', 'num']),
    'D': ('adv', ['adv', 'particle']),
    'T': ('prep', ['prep', 'adv']),
    'C': ('conj', ['conj']),
    'P': ('pron', ['pron', 'det', 'article', 'num']),
    'I': ('intj', ['intj']),
    'U': ('part', ['particle', 'conj', 'pron', 'adv']),
}
# Sentence tokens whose automatic mapping is wrong: token -> lemma
FORM_OVERRIDES = {'dem': 'de', 'mine': 'min', 'dine': 'din', 'sine': 'sin', 'jer': 'I'}
SKIP_SENSE_TAGS = {'obsolete', 'archaic', 'dated', 'rare'}
HERE = __file__.rsplit('/', 1)[0]


def fold(s):
    """Lowercase and drop accents, but keep å (a + combining ring) and æ/ø."""
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c) or c == '̊')
    return unicodedata.normalize('NFC', s)


def clean_gloss(g, limit=60):
    g = re.sub(r'\s*\([^()]*\)', '', g)
    g = re.sub(r'\s+', ' ', g).strip(' ;,:')
    if len(g) > limit:
        g = g[:limit].rsplit(' ', 1)[0].rstrip(' ,;') + '…'
    return g


def load_kaikki(path):
    idx = {}
    with gzip.open(path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            d = json.loads(line)
            if d.get('lang_code') == 'da':
                idx.setdefault(d['word'], []).append(d)
    return idx


def real_glosses(d):
    out = []
    for s in d.get('senses', []):
        tags = set(s.get('tags') or [])
        if 'form-of' in tags or 'alt-of' in tags or not s.get('glosses'):
            continue
        out.append((bool(tags & SKIP_SENSE_TAGS), clean_gloss(s['glosses'][-1])))
    return out


def form(d, *want, avoid=()):
    """First form of a kaikki entry carrying all tags in `want` and none in `avoid`."""
    for f in d.get('forms') or []:
        tags = set(f.get('tags') or [])
        if set(want) <= tags and not tags & set(avoid):
            v = f.get('form', '').strip()
            if v and v != '-' and 'table-tags' not in tags and 'inflection-template' not in tags:
                return v
    return ''


def summary(d, code):
    """Short forms line shown under the word."""
    parts = []
    if code == 'n':
        parts = [form(d, 'definite', 'singular', avoid=('genitive',)),
                 form(d, 'indefinite', 'plural', avoid=('genitive',))]
    elif code == 'v':
        perf = form(d, 'perfect')
        parts = [form(d, 'present', avoid=('passive',)), form(d, 'past', avoid=('passive', 'participle')),
                 re.sub(r'^(har|er)\s+', '', perf)]
    elif code == 'adj':
        parts = [form(d, 'neuter'), form(d, 'plural') or form(d, 'definite'),
                 form(d, 'comparative'), form(d, 'superlative', 'predicative') or form(d, 'superlative')]
    parts = [p for p in parts if p]
    return ' · '.join(parts)


def gender(d):
    head = ' '.join(h.get('expansion', '') for h in d.get('head_templates') or [])
    m = re.match(r'\S+\s+(c|n)(?:\s+or\s+(c|n))?\b', head)
    if not m:
        return ''
    art = {'c': 'en', 'n': 'et'}
    return art[m.group(1)] + ('/' + art[m.group(2)] if m.group(2) and m.group(2) != m.group(1) else '')


def best_entry(idx, w, kpos):
    cands = [d for d in idx.get(w, []) if real_glosses(d)]
    if not cands:
        return None
    cands.sort(key=lambda d: (kpos.index(d['pos']) if d.get('pos') in kpos else 99))
    return cands[0]


def regular_noun_forms(w, art):
    """Regular Danish noun forms: definite singular, plurals, definite plurals."""
    base = w[:-1] if w.endswith('e') else w
    out = [w + ('t' if art == 'et' else 'n') if w.endswith('e') else w + ('et' if art == 'et' else 'en')]
    out += [base + 'er', base + 'erne', w + 's']
    if art == 'et' or w.endswith('e'):
        out += [base + 'e', base + 'ene']
    return out


SINGLE_WORD = re.compile(r"^[a-zA-ZæøåÆØÅéÉüÜöÖäÄ'-]+$")


def load_tsv(path):
    """{first column: [other columns]} of a TSV file with # comments."""
    out = {}
    try:
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                if line.strip() and not line.startswith('#'):
                    parts = [p.strip() for p in line.rstrip('\n').split('\t')]
                    out[parts[0]] = parts[1:]
    except FileNotFoundError:
        pass
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    lemma_path, kaikki_path = args[0], args[1]
    out_path = args[2] if len(args) > 2 else 'data/words.js'
    idx = load_kaikki(kaikki_path)
    glosses_de = load_tsv(HERE + '/glosses-de.tsv')
    skip = set(load_tsv(HERE + '/skip.tsv'))

    # merge homographs, keep the word class of the most frequent reading
    lemmas = {}
    order = []
    with open(lemma_path, encoding='utf-8') as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            if len(parts) != 3 or parts[0] not in POS_MAP:
                continue
            pos, w, freq = parts[0], parts[1].strip(), float(parts[2])
            if not SINGLE_WORD.match(w) or w != w.lower() or w in skip:
                continue
            if w in lemmas:
                lemmas[w]['freq'] += freq
                lemmas[w]['pos'].append(pos)
                continue
            lemmas[w] = {'w': w, 'freq': freq, 'pos': [pos]}
            order.append(w)

    words = []
    total = sum(LEVEL_SIZES)
    for w in order:
        item = lemmas[w]
        code, kpos = POS_MAP[item['pos'][0]]
        all_kpos = kpos + [k for p in item['pos'][1:] for k in POS_MAP[p][1]]
        d = best_entry(idx, w, all_kpos)
        if d is None and w not in glosses_de:
            continue      # not in Wiktionary: mostly corpus noise (typos, names)
        en = []
        a = r = ''
        if d is not None:
            seen = set()
            for rare, g in sorted(real_glosses(d), key=lambda x: x[0]):
                if g and g.lower() not in seen:
                    seen.add(g.lower())
                    en.append(g)
            if code == 'n':
                a = gender(d)
            r = summary(d, code)
        de = glosses_de.get(w) or ['']
        words.append({'w': de[1] if len(de) > 1 and de[1] else w, 'lemma': w,
                      'a': a, 'r': r, 'e': de[0], 'p': code,
                      'en': '; '.join(en[:4]), 'freq': item['freq'], 'entry': d})
        if len(words) == total:
            break

    out = []
    lvl_of = []
    for lvl, n in zip(LEVELS, LEVEL_SIZES):
        lvl_of += [lvl] * n
    for i, d in enumerate(words, 1):
        e = {'id': i, 'l': lvl_of[i - 1]}
        for k in ('w', 'a', 'r', 'e', 'p'):
            if d[k]:
                e[k] = d[k]
        e['f'] = i
        out.append(e)

    if '--worklist' in sys.argv:
        for d in words:
            if not d['e']:
                print(d['lemma'] + '\t' + d['p'] + (' ' + d['a'] if d['a'] else '') + '\t' + d['en'][:90])
        return

    # forms.json: folded word form -> word id, for finding words in sentences.
    # On a clash the more frequent word (lower id) wins, lemma or not: "kører"
    # is far more often a form of "køre" than the noun "kører" (driver).
    # Display forms with a space ("i går") register no key, so "går" stays
    # with "gå"; listed display forms ("al, alt, alle") count as lemmas.
    # Pronoun tables are not trusted to take another word's lemma ("vores"
    # stays its own word instead of a form of "vi").
    forms = {}
    lemma_keys = set()

    def put(key, wid):
        if key and (key not in forms or forms[key] > wid):
            forms[key] = wid

    for e, d in zip(out, words):
        if not (' ' in e['w'] and ',' not in e['w']):
            for v in [d['lemma']] + e['w'].split(','):
                put(fold(v.strip()), e['id'])
                lemma_keys.add(fold(v.strip()))
    for e, d in zip(out, words):
        has_table = False
        for entry in idx.get(d['lemma'], []):
            for f in entry.get('forms') or []:
                tags = f.get('tags') or []
                if 'table-tags' in tags or 'inflection-template' in tags:
                    continue
                v = re.sub(r'^(at|har|er|\(er\s*/var\))\s+', '', f.get('form', '').strip())
                if SINGLE_WORD.match(v):
                    has_table = True
                    if fold(v) not in lemma_keys or e.get('p') in ('v', 'adj', 'n'):
                        put(fold(v), e['id'])
        if e.get('p') == 'n' and not has_table:
            # Wiktionary has no table (e.g. "morgen"): add the regular forms,
            # only where no other word has claimed the key.
            for v in regular_noun_forms(d['lemma'], e.get('a', '')):
                k = fold(v)
                if k not in forms:
                    forms[k] = e['id']
    id_of = {d['lemma']: e['id'] for e, d in zip(out, words)}
    for token, lemma in FORM_OVERRIDES.items():
        if lemma in id_of:
            forms[fold(token)] = id_of[lemma]
    forms_path = out_path.rsplit('/', 1)[0] + '/forms.json'
    with open(forms_path, 'w', encoding='utf-8') as fh:
        json.dump(forms, fh, ensure_ascii=False, separators=(',', ':'))
    print('forms:', len(forms), file=sys.stderr)

    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/build-words.py — DSL "De hyppigste ord i dansk" (DSL Åben Licens),\n')
        fh.write('// forms from Wiktionary via kaikki.org (CC BY-SA), German glosses hand-written. Do not edit by hand.\n')
        fh.write('var WORDS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')

    missing = [e for e in out if not e.get('e')]
    print('words:', len(out), 'without German gloss:', len(missing), file=sys.stderr)
    for lvl in LEVELS:
        print(' ', lvl, sum(1 for e in out if e['l'] == lvl),
              'missing', sum(1 for e in missing if e['l'] == lvl), file=sys.stderr)


if __name__ == '__main__':
    main()
