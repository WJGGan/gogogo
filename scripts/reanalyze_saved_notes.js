/** Re-run Researcher and Curator over captured note details; no XHS requests. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from '../src/config/env.js';
import { createResearcherAgent } from '../src/agents/researcher.js';
import { createCuratorAgent } from '../src/agents/curator.js';
import { captureStage } from '../src/data/run-captures.js';

loadEnvFile();
const sourceRunId = process.argv[2];
if (!sourceRunId) throw new Error('Usage: node scripts/reanalyze_saved_notes.js <sourceRunId>');
const sourceDirectory = join(process.cwd(), 'data', 'captures', 'runs', sourceRunId);
const [planFile, notesFile, searchFile] = await Promise.all([
  readFile(join(sourceDirectory, 'keyword-plan.json'), 'utf8'),
  readFile(join(sourceDirectory, 'evidence-notes.json'), 'utf8'),
  readFile(join(sourceDirectory, 'merged-search.json'), 'utf8'),
]);
const plan = JSON.parse(planFile).data;
const notes = JSON.parse(notesFile).data;
const searchNotes = JSON.parse(searchFile).data.notes || [];
const searchById = new Map(searchNotes.map((note) => [note.id, note]));
// Older evidence snapshots omitted search provenance; restore matched keywords
// so the Researcher can judge relevance based on the query that found the note.
for (const note of notes) {
  const searched = searchById.get(note.id);
  if (searched) Object.assign(note, {
    url: note.url || searched.url,
    coverUrl: note.coverUrl || searched.coverUrl,
    matchedKeywords: note.matchedKeywords || searched.matchedKeywords || [],
  });
}
const runId = randomUUID();
const brief = { ...plan.brief, facets: plan.facets };
const research = await createResearcherAgent().analyze({ brief, notes });
await captureStage(runId, 'research', { sourceRunId, ...research });
const curation = await createCuratorAgent().compose({ brief, groups: research.groups, notes });
await captureStage(runId, 'curation', { sourceRunId, ...curation });
console.log(JSON.stringify({
  runId, sourceRunId,
  research: { provider: research.provider, relevantCount: research.relevantCount,
    detailNoteCount: research.detailNoteCount, groups: research.groups.map((group) => group.theme), warning: research.warning },
  curation: { provider: curation.provider, cards: curation.cards.map((card) => ({
    title: card.title, angle: card.angle, evidenceLevel: card.evidenceLevel,
    sources: card.sources.map((source) => source.title),
  })), warning: curation.warning },
}, null, 2));
