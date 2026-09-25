// The ids the recorded interaction fixture uses, shared by its builder and the tests.

export const IDS = {
  project: '0199a000-0000-7000-8000-00000000aa01',
  message: '0199a000-0000-7000-8000-00000000bb01',
  run1: '0199a000-0000-7000-8000-00000000c001',
  run2: '0199a000-0000-7000-8000-00000000c002',
  call1: '0199a000-0000-7000-8000-00000000d001',
  call2: '0199a000-0000-7000-8000-00000000d002',
  session: '4d3c2b1a-0f9e-4d7c-8b6a-5f4e3d2c1b0a',
  batch: '0199a000-0000-7000-8000-00000000e001',
  proposal: '0199a000-0000-7000-8000-00000000f001',
  pack1: 'a'.repeat(64),
  delta: 'd'.repeat(64),
  interaction1: '0199a100-0000-7000-8000-000000000001',
  interaction2: '0199a100-0000-7000-8000-000000000002',
  interaction3: '0199a100-0000-7000-8000-000000000003',
} as const;

export const TEXTS = {
  systemPrompt: 'You are the explorer of DEMIURGO. Answer with a proposal.',
  input: 'What is the purpose of the project?',
  outputRaw: '{"answer":"To design itself."}',
  delta: 'New message: what about the second pillar?',
} as const;
