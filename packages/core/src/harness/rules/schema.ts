// `schema.prediction` (B02): Jev's opinion of whether the task changes the database schema, against whether the
// pull request really added a file under a `migrations/` directory (G13). Positive = «changes the schema».

import { SCHEMA_THRESHOLD } from '../../classifier/layers.ts';
import type { Rule } from './index.ts';
import { realFilesOf } from './common.ts';

const MIGRATION = /(^|\/)migrations\//;

export const schemaPrediction: Rule = (inputs) => {
  const opinion = inputs.layersOpinion;
  if (!opinion) return [];
  // Only a merged request says what the pull request really added.
  if (inputs.request.state !== 'done') return [];
  const files = realFilesOf(inputs.steps);
  if (!files) return [];
  const migrations = files.filter((f) => MIGRATION.test(f));
  const predicted = opinion.schema_p >= SCHEMA_THRESHOLD;
  const actual = migrations.length > 0;
  return [
    {
      piece: 'B02',
      finding: 'schema.prediction',
      class: predicted ? (actual ? 'tp' : 'fp') : actual ? 'fn' : 'tn',
      ground_truth: 'G13',
      value: opinion.schema_p,
      subject: inputs.taskCode,
      evidence: { layers_opinion: opinion.id, schema_p: opinion.schema_p, threshold: SCHEMA_THRESHOLD, migrations },
    },
  ];
};
