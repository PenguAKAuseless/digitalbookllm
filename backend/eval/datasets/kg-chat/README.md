# KG-Chat: does the knowledge graph learn from conversations?

**Question it answers:** when the user chats with the assistant, does the
personal knowledge graph pick up the entities and relations mentioned in the
conversation, add the new ones, and attach them to the entities it already
holds (from books read earlier), without duplicating them? (FR-06, UC-15,
TC-KG-01.)

## File

`dialogues.json` — 40 dialogues, 297 turns, with 175 annotated entities and
137 annotated relations (triples) that occur in the dialogue text. Each entry:
`id`, `sourceRow` (row in the original CSV), `turns` (`sender`, `text`),
`entities`, `triples` (`subject`, `relation`, `object`).

## Source and licence

**OpenDialKG** (Moon, Shah, Kumar, Subba, *OpenDialKG: Explainable
Conversational Reasoning with Attention-based Walks over Knowledge Graphs*,
ACL 2019), `data/opendialkg.csv`, **CC BY-NC 4.0**. Crowd workers held
conversations about movies, books, sport and music while recording, turn by
turn, the knowledge-graph walk the conversation follows, e.g.
`(Iron Man, starred_actors, Robert Downey Jr.)`. Dialogue text and triples are
OpenDialKG's, unchanged; this subset is likewise CC BY-NC 4.0 (non-commercial
use, with attribution).

## Construction (`eval/experiments/build-chat-benchmark.ts`, deterministic)

- Dialogues are read in file order. Inverse relations (`~r`) are flipped to
  `r` with subject and object swapped.
- Only annotated entities that are actually said in the dialogue count (as
  whole words, with or without a parenthesised qualifier such as
  "Zodiac (Crime Fiction Film)" → "Zodiac"); a triple counts if both of its
  entities are said.
- A dialogue is kept if it has at least 3 such entities and 2 such triples.
  The first 40 kept dialogues are rows 1–98 of the CSV.

## Example (KGC-01)

> **user:** Do you like Iron Man
> **assistant:** Sure do! Robert Downey Jr. is a favorite.
> **user:** Yes i like him too did you know he also was in Zodiac a crime fiction film.
> **assistant:** I like crime fiction! Didn't know RDJ was in there. Jake Gyllenhaal starred as well.
> **user:** So he did he also starred in End of Watch have you ever seen that movie?
> **assistant:** Yes I have! I like films directed by David Ayer. How about you?

Annotated entities: Iron Man, Robert Downey Jr., Zodiac (Crime Fiction Film),
Jake Gyllenhaal, End of Watch, David Ayer, Thriller.
Annotated triples: Iron Man → starred_actors → Robert Downey Jr.;
Zodiac → starred_actors → Robert Downey Jr.; Zodiac → starred_actors → Jake Gyllenhaal;
End of Watch → starred_actors → Jake Gyllenhaal; End of Watch → written_by → David Ayer;
End of Watch → has_genre → Thriller.

## Evaluation protocol (`eval/experiments/experiment-4-kg-chat.ts`)

- The user's graph starts as the graph of the three KG-Series volumes (a
  user who has read those books).
- The dialogues are processed one after another, each as one chat-extraction
  job through the production extractor, and merged into the graph as the
  worker does.
- Measured: annotated entity and relation recall; share of extracted entities
  named in the dialogue (grounding); new entities per dialogue; share of new
  entities attached by an edge to an entity the graph already held; reuse of
  entities already in the graph (scored on those the extractor named: merged
  into the existing node rather than duplicated); duplicate entities (same
  name, other letter case). A no-LLM baseline (capitalised phrases, same-turn
  co-occurrence edges) is scored on the same dialogues.
