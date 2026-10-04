# KG-Series: a three-volume benchmark for cross-book knowledge-graph retrieval

**Question it answers:** after a user has read volume 1, does the knowledge
graph built from it let the assistant answer a question asked while reading
volume 2 — when the answer is only in volume 1?

Every answer in this benchmark lies in the volume read *before* the one the
question is asked in, never in the volume being read. A system that searches
only the open book cannot answer any question; it has to link the open book
to an earlier one, through an entity both mention.

## Files

| File | Content |
|---|---|
| `volume-1.txt` | Volume 1 — 31,033 characters, 60 sections, ~4,960 words |
| `volume-2.txt` | Volume 2 — 70,660 characters, 120 sections, ~11,270 words |
| `volume-3.txt` | Volume 3 — 28,710 characters, 60 sections, ~4,650 words |
| `questions.json` | 40 questions with reference answers and annotated evidence (volume, character offset, sentence) |

The volumes are plain text, one section per Wikipedia article (title line,
then the paragraph), so they can be uploaded to the app as TXT documents in
one workspace, in order, to reproduce the scenario by hand.

## Source and licence

Built from **HotpotQA** (Yang et al., *HotpotQA: A Dataset for Diverse,
Explainable Multi-hop Question Answering*, EMNLP 2018), distractor setting,
**validation split**, CC BY-SA 4.0. Questions, answers, paragraphs and the
supporting-sentence annotations are HotpotQA's, unchanged; only their
arrangement into volumes is ours. This derived dataset is therefore also
CC BY-SA 4.0.

## Construction (`eval/experiments/build-series.ts`, deterministic)

HotpotQA *bridge* questions need two paragraphs: a **bridge paragraph** about
the entity the question names, which mentions a second entity, and an
**answer paragraph** about that second entity, which holds the answer.

Questions are read in dataset order and kept only if:

1. it is a bridge question with exactly two evidence paragraphs;
2. the answer occurs in one of them (the answer paragraph) and not in the other;
3. the bridge paragraph names the answer paragraph's subject, so the link is in the text;
4. none of its paragraphs is used by an earlier kept question;
5. after assembly, the answer string occurs nowhere in the volume the question is asked in.

The first 40 questions that pass (of the first 133 in the split; 10 were
dropped by rule 5) alternate between two groups:

| Volume | Contains | Questions asked while reading it |
|---|---|---|
| 1 | answer paragraphs of group A, + 2 of each question's own distractor paragraphs | — |
| 2 | bridge paragraphs of group A + answer paragraphs of group B, + 2 distractors each | group A (20): answer in volume 1 |
| 3 | bridge paragraphs of group B, + 2 distractors each | group B (20): answer in volume 2 |

Distractors are the question's own HotpotQA distractor paragraphs (retrieved
by HotpotQA's authors for their similarity to the question), so the volume
being read always holds look-alike passages.

## Sample questions

| ID | Asked while reading | Question | Reference answer | Link the system must follow |
|---|---|---|---|---|
| KGS-01 | Volume 2 | What government position was held by the woman who portrayed Corliss Archer in the film Kiss and Tell? | Chief of Protocol | *Kiss and Tell (1945 film)* (vol. 2) → **Shirley Temple** (vol. 1) |
| KGS-02 | Volume 3 | The director of the romantic comedy "Big Stone Gap" is based in what New York city? | Greenwich Village, New York City | *Big Stone Gap (film)* (vol. 3) → **Adriana Trigiani** (vol. 2) |
| KGS-03 | Volume 2 | The arena where the Lewiston Maineiacs played their home games can seat how many people? | 3,677 seated | *Lewiston Maineiacs* (vol. 2) → **Androscoggin Bank Colisée** (vol. 1) |
| KGS-04 | Volume 3 | The football manager who recruited David Beckham managed Manchester United during what timeframe? | from 1986 to 2013 | *1995–96 Manchester United F.C. season* (vol. 3) → **Alex Ferguson** (vol. 2) |
| KGS-05 | Volume 2 | Brown State Fishing Lake is in a country that has a population of how many inhabitants? | 9,984 | *Brown State Fishing Lake* (vol. 2) → **Brown County, Kansas** (vol. 1) |
| KGS-08 | Volume 3 | What was the father of Kasper Schmeichel voted to be by the IFFHS in 1992? | World's Best Goalkeeper | *Kasper Schmeichel* (vol. 3) → **Peter Schmeichel** (vol. 2) |

Worked example, KGS-01. Volume 2, being read, says *"Kiss and Tell is a 1945
American comedy film starring then 17-year-old Shirley Temple as Corliss
Archer."* Volume 1, read earlier, says *"Shirley Temple Black … was an
American actress, singer, dancer, businesswoman, and diplomat …"* and that
she served as Chief of Protocol. Nothing in volume 2 states the answer. The
intended path: extracting volume 2 gives an edge such as *Kiss and Tell →
starring → Shirley Temple*; the entity *Shirley Temple* already exists from
volume 1 (entities are merged by name per user), so the edge leads retrieval
to the volume 1 passage, which the answer then cites as "Volume 1, page …".

## Evaluation protocol (`eval/experiments/experiment-3-kg-series.ts`)

- Reading order is simulated: a question asked in volume *v* sees a workspace
  of volumes 1..*v* and a knowledge graph extracted from those volumes only.
- Retrieval returns 5 passages (the production top-k).
- **Answer@5**: a passage containing an annotated supporting sentence of the
  answer paragraph (earlier volume) is retrieved. **Bridge@5**: same for the
  bridge paragraph (current volume). **Chain@5**: both.
