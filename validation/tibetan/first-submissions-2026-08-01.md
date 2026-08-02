# First two independent Tibetan submissions (2026-08-01)

The first real Tibetan the project has ever received. Two reviewers translated the same 174 analyte
names independently, without contact. One of them also translated all 174 definitions.

**No translations are committed here, and no reviewer is named.** This records what was measured and
what was learned. The submissions themselves are reviewer work product and unreconciled; treating
them as data before reconciliation would be exactly the mistake this file exists to prevent.

---

## What was measured

174 names compared, both filled in every row.

| | count |
|---|---|
| identical | **1** |
| identical after stripping Tibetan punctuation | 3 |
| similar (≥0.6 character overlap after stripping) | 77 |
| substantially different word choice | **93** |

Under the rule as written in `docs/field/RECRUIT-tibetan-reviewers.md` — reject any row where the two
disagree — this publishes one term.

## The disagreement is systematic, not careless

The 93 are not scattered. The two reviewers used different words consistently, and it shows in the
syllable frequencies across all 174 names:

```
ཕྲ    r1 33  r2 14        ཁྲག   r1 16  r2 34
རྡུལ   r1  2  r2 23        ཕྲག   r1  7  r2  0
རྫས   r1  5  r2 46        དཀར   r1 18  r2  6
```

One reviewer builds descriptive Tibetan coinages; the other transliterates the international term.
Both are principled positions. Asked afterwards, each described the other's work as correct.

So the 93 rows turn on roughly four questions rather than 93 arguments. They are now recorded as
formal decision rows in `lib/tibetanImport.ts` (`buildDecisionRows`), stated without quoting any
Tibetan, because the packet is asserted to contain none: a draft quoted in a decision row would
anchor the next reviewer's vocabulary before they translate a word.

## Both reviewers independently framed it as REGISTER

Neither was asked about register. Both raised it.

- Reviewer 1: 我用的基本上是书面语 (I mostly used the written register)
- Reviewer 2: described his own as 更口语化, and said the formal written standard is the word
  reviewer 1 used

So two of the four questions may not be vocabulary disputes at all. The open question is which
register this product should speak in: it is written text, but its job is what a doctor would say
out loud to a patient. Nobody has decided that, and no credential decides it.

## A flagged anomaly that was NOT an error

Reviewer 1 used two different words where an automated check saw inconsistency. Asked, he explained
the rule: blood as a substance and a blood CELL cannot take the same word.

Checked against his file:

| | word | rows | content |
|---|---|---|---|
| blood (substance) | ཕྲག | 7 | all genuinely about blood |
| cell | ཕྲ་ཕུང | 19 | all genuinely about cells |

**Six of the seven rows flagged as suspect were a principled morphological distinction.** Exactly one
row broke his own rule (红细胞压积, which took the blood word where its 19 siblings take the cell
word), and he confirmed on inspection that it was a typo.

Had the process simply returned every disagreement, a self-consistent system would have been sent
back as an error, and its author told his professional judgement was rejected.

**Confirmed and amended by its author on 2026-08-02.** Asked again, he confirmed 红细胞压积 was a
slip and supplied a replacement string. Not quoted here, for the same reason nothing else is.

Two things about that amendment are worth stating, because they will recur. First, it is the author
correcting his own submission, not a second person overruling him, so it does not touch the
two-person rule — the amended row still needs reviewer 2's independent row to agree before anything
publishes. Second, we flagged the row before he looked at it, and feedback pulls answers. This one is
safe because the rule he applied is one he had already stated to us unprompted, and the row deviated
from *his* rule rather than converging on ours. That will not be true of every correction. The
original submission is kept unmodified and the amendment recorded separately, so which is which stays
auditable.

## A translation criterion our brief never mentioned

Reviewer 1, unprompted: 要美观，要好听，读起来要顺口 — collocation and euphony. He gave a concrete
example: a longer form was available, but because the preceding element carried a particular letter,
he chose a shorter one that read better.

This matters more than style. In the companion-reader flow, a younger relative reads the term ALOUD
to an elderly patient, so how a term sounds is a functional property.

It also has a consequence for measurement: **if word choice legitimately varies with what precedes
it, then exact-match comparison between two translators is measuring the wrong thing.** Part of the
174-to-1 figure is this rule working normally, not disagreement.

He restated the rule on 2026-08-02 with the same example: the longer form was available, but a
preceding letter T made the short form read better and simpler, so he used the short form.

**Where the rule is and is not load-bearing.** It varies the *form* of a term the translator has
already chosen, so it belongs among the 77 rows scored similar, and cannot explain the 93 scored
substantially different — those are two translators choosing different terms outright. This is an
inference from what the rule does, not a re-scored measurement. It is worth keeping straight, because
the tempting reading is that collocation explains the whole 174-to-1 result. It does not. It explains
why agreement was 1 rather than something like 70.

**Asked whether this is a Tibetan translation convention or his own habit, he said: both, and he is
not sure.** His words: it is how he himself thinks about it, but the 初中藏文课本 he was taught from
sets out translation standards that require choosing words by collocation; whether contemporary
translation practice still requires it, he does not know.

That answer is more useful than a confident one either way. A taught standard he can name is
checkable. It also means we cannot yet decide the question the answer was meant to settle: if the
convention is general, two translators diverging on these rows is normal and returning them would be
wrong; if it is personal, we have to pick one and impose it.

## What this says about our design

The recruitment brief described reconciliation as an exception and estimated the work at
「几次工作时段」. Near-total disagreement is the normal outcome of two independent translators, and
reconciliation is the main event. That should have been in the brief, and reviewers should be told so
explicitly, or they will read the result as criticism.

Exact string match is also the wrong comparator. It cannot distinguish a punctuation variant from a
different term, and it counts legitimate collocation variance as conflict. What survives is the
principle underneath: no single person's judgement is the last word, and the code never picks a
winner.

## Open

- Which register the product should use. Needs the reader test in
  `docs/field/TEST-term-comprehension.md`, not an appeal to qualifications.
- Whether a standard Tibetan vocabulary for these analytes exists at all. The two reviewers
  contradict each other on this, and it is checkable: one cites a Tibetan medical dictionary and
  hospital reports, the other says lab reports are all in Chinese so no fixed usage exists. The
  source has been requested.
- Whether the collocation rule is a general convention or a personal one. Reviewer 1 has named a
  source (translation standards in the 初中藏文课本) but flags that he does not know its current
  status. **Deliberately not chased.** The question only bites at reconciliation, and definitions
  cannot reach reconciliation until a second reviewer translates them. When it does bite, putting
  real rows in front of reviewer 1 answers it better than a citation would, and costs him nothing.
  Until then, treat every collocation-driven difference as unresolved rather than as conflict —
  returning it would be asking a translator to break a rule he was taught.
- All 174 definitions currently have one opinion. They cannot be published under the two-person
  rule until a second reviewer translates them independently.
