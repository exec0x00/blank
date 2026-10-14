export const meta = {
  name: 'study-pack',
  description: 'Build a six-document HTML+PDF study pack (pesu-study-pack skill) for any scope: topic, section, unit or subject',
  whenToUse: 'User wants study packs for a large scope (several sessions, a unit, several units, a whole subject) from the PESU bucket or a local folder, and asked for a workflow / multi-agent run.',
  phases: [
    { title: 'Scout', detail: 'inventory sources, download, render, topic map, split into lanes' },
    { title: 'Extract', detail: 'one extractor per lane, then a skeptical verifier per lane' },
    { title: 'Build', detail: 'figures, HTML, PDF, standalone HTML, QA, visual fixes' },
    { title: 'Review', detail: 'fidelity, design and completeness critics' },
    { title: 'Fix', detail: 'apply review findings, rebuild, final QA' },
  ],
}

// args: { source: "https://huggingface.co/buckets/alvin3y10/data/tree/pesuc" | "/path/to/folder",
//         scope: "UE26MA141A Unit 1, class 002 only" | "Engineering Chemistry Unit 2" | ...,
//         pack_dir: "packs/<name>",  skill_dir: ".claude/skills/pesu-study-pack" }
const A = args || {}
const SKILL = A.skill_dir || '.claude/skills/pesu-study-pack'
const PACK = A.pack_dir
if (!PACK || !A.scope) throw new Error('args.pack_dir and args.scope are required')
const SRC = A.source || 'https://huggingface.co/buckets/alvin3y10/data/tree/pesuc'
const READ = `Read ${SKILL}/SKILL.md and every file in ${SKILL}/references/ (lessons.md first). Study the example pack in ${SKILL}/examples/maths-u1-geometrical-interpretation/.`

phase('Scout')
const LANES_SCHEMA = {
  type: 'object',
  properties: {
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lane: { type: 'string', description: 'short id, e.g. a, b, c' },
          topics: { type: 'array', items: { type: 'string' }, description: 'topic ids this lane owns, e.g. ["T4","T5"]' },
          sessions: { type: 'string', description: 'which decks/transcripts/videos (NNN_ prefixes) and which local paths' },
          notes: { type: 'string', description: 'known issues, gaps, ESA questions mapped to these topics' },
        },
        required: ['lane', 'topics', 'sessions'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['lanes', 'summary'],
}
const scout = await agent(
  `${READ}\n\nYou are the scout for a study pack. Scope: ${A.scope}. Source: ${SRC}. Pack directory: ${PACK}.\n` +
  `Do SKILL.md steps 0–4: run setup.sh; scaffold the pack with new_pack.py if ${PACK}/pack.py does not exist; inventory every source in scope ` +
  `(slides in all formats, transcripts in all formats, consolidated PDFs, CW sheets, ESA papers; NOT videos); download them to ${PACK}/work/sources; ` +
  `render every deck and every relevant paper page to ${PACK}/work/render; read the past papers and map in-scope questions to topics. ` +
  `Write ${PACK}/pack.py (PACK metadata: sources, gaps incl. failed videos, asr_forbidden, pyq_note draft, tag_legend; MODULES for unit-or-larger scopes) ` +
  `and ${PACK}/parts/00_topics.py containing ONLY the TOPICS list (ids T1… in teaching order, titles, overviews).\n` +
  `Then split the topics into lanes of about 2–3 sessions each (max 8 lanes; 1 lane for a single session). Return the lanes.`,
  { label: 'scout', phase: 'Scout', schema: LANES_SCHEMA })
if (!scout || !scout.lanes.length) throw new Error('scout returned no lanes')
log(`${scout.lanes.length} lane(s): ${scout.lanes.map(l => l.lane + '=' + l.topics.join('/')).join(', ')}`)

const LANE_REPORT = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    counts: { type: 'string' },
    video_frames: { type: 'string', description: 'frames grabbed and the trigger for each, or "none"' },
    open_gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'counts', 'video_frames', 'open_gaps'],
}
const VERDICT = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' }, description: 'problems found and fixed in the lane files' },
    remaining: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'remaining'],
}

const lanes = await pipeline(
  scout.lanes,
  l => agent(
    `${READ}\n\nYou are extraction lane "${l.lane}" of a study pack in ${PACK}. Scope of the whole pack: ${A.scope}.\n` +
    `Your sessions: ${l.sessions}. Your topics (already in ${PACK}/parts/00_topics.py; do not edit that file): ${l.topics.join(', ')}. Notes: ${l.notes || '-'}.\n` +
    `Sources are already downloaded in ${PACK}/work/sources and rendered in ${PACK}/work/render.\n` +
    `Do SKILL.md steps 3, 5 and 6 for YOUR topics only. Write ONLY these files: ${PACK}/parts/${l.lane}.py (all content lists, every item with topic ∈ your topics) ` +
    `and ${PACK}/figs/${l.lane}.py (FIGURES dict using figstyle). Use only IDs numbered by your topics (E<t>.k, G<t>.k, F<t>.k, W<t>.k, C<t>.k).\n` +
    `Read every rendered slide image (contact sheets), every transcript fully; verify every number with sympy; videos only via grab_frame.sh for the five triggers.\n` +
    `Test your figures: python3 -I ${SKILL}/engine/figures_run.py ${PACK} <your G ids> and look at them with preview_figs.py. Do not run make.sh or edit pack.py/engine files.`,
    { label: `extract:${l.lane}`, phase: 'Extract', schema: LANE_REPORT }),
  (rep, l) => agent(
    `${READ}\n\nAdversarially verify lane "${l.lane}" of the study pack in ${PACK} (files ${PACK}/parts/${l.lane}.py and ${PACK}/figs/${l.lane}.py; sessions: ${l.sessions}).\n` +
    `Assume it is wrong until checked. For EVERY formula, compare against the rendered slide image in ${PACK}/work/render (not the .slides.md). ` +
    `Re-solve every worked example with sympy. Check every statement's wording against the slide. Check every item has correct srcs and honest flags. ` +
    `Check coverage: every slide and transcript passage of these sessions with content is represented; nothing out of scope (${A.scope}) crept in. ` +
    `Check ASR errors were corrected (lessons §11). Fix problems directly in those two files only. Extractor report: ${JSON.stringify(rep)}`,
    { label: `verify:${l.lane}`, phase: 'Extract', schema: VERDICT }).then(v => ({ lane: l.lane, report: rep, verify: v })),
)

phase('Build')
const build = await agent(
  `${READ}\n\nBuild the study pack in ${PACK}. Do SKILL.md step 7: fill any missing pack-wide lists (TOP_FACTS, TOP_FORMULAS, MNEMONICS, RAPID if lanes left them thin) in ${PACK}/parts/zz_summary.py, ` +
  `then run bash ${SKILL}/scripts/make.sh ${PACK} --sheets and python3 -I ${SKILL}/scripts/preview_figs.py ${PACK}. Read EVERY figure sheet and EVERY QA sheet in ${PACK}/work/qa. ` +
  `Fix every problem (content files, figures; engine files under ${SKILL}/engine only for genuine design bugs, then add the lesson to ${SKILL}/references/lessons.md) and rebuild until QA passes and the sheets look right. ` +
  `Lane results: ${JSON.stringify(lanes.filter(Boolean))}. Return page counts, QA output and what you fixed.`,
  { label: 'build', phase: 'Build' })

phase('Review')
const FINDINGS = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: {
    where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['where', 'problem', 'fix'] } } },
  required: ['findings'],
}
const LENSES = [
  ['fidelity', 'Mathematical and factual fidelity: sample at least 40 items across all topics (every formula, every worked answer) and compare against the rendered sources in work/render and the transcripts. Any wrong sign, symbol, constant, unit or wording is a finding.'],
  ['design', `Design conformance: compare the PDFs (render pages with ${SKILL}/scripts/sheet.py at 70 dpi) against ${SKILL}/references/design.md and the two templates in ${SKILL}/references/templates. Label collisions, overflow, split figures, half-empty pages, inconsistent captions, colours off-palette are findings.`],
  ['completeness', `Completeness and scope: list every source file in scope (work/sources) and check each is cited; every slide with content is represented; every in-scope past-paper question appears with a worked solution; nothing outside "${A.scope}" crept in; gaps are recorded in PACK["gaps"].`],
]
const reviews = await parallel(LENSES.map(([k, p]) => () => agent(
  `${READ}\n\nReview the built study pack in ${PACK}/output (lens: ${k}). ${p} Do not edit files; return findings.`,
  { label: `review:${k}`, phase: 'Review', schema: FINDINGS })))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`${findings.length} review finding(s)`)

phase('Fix')
const fix = findings.length ? await agent(
  `${READ}\n\nApply these review findings to the study pack in ${PACK} (verify each one first; skip any that are wrong and say why), ` +
  `rebuild with bash ${SKILL}/scripts/make.sh ${PACK} --sheets, re-check the sheets, and return the final page counts and QA output.\n` +
  JSON.stringify(findings, null, 1), { label: 'fix', phase: 'Fix' }) : 'no findings'

return { lanes: lanes.filter(Boolean), build, findings, fix }
