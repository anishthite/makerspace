import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const rubric = [
  { key: 'wedge', label: 'Wedge', weight: 14, question: 'Is the promise sharp enough to own a market sentence?' },
  { key: 'portablePi', label: 'Portable Pi', weight: 18, question: 'Does it foreground local Pi skills, prompts, AGENTS.md, model defaults, and habits on a remote agent?' },
  { key: 'browserRemote', label: 'Browser Remote', weight: 12, question: 'Can someone understand Pi running from the browser against cloud sandboxes?' },
  { key: 'recurrence', label: 'Recurring', weight: 10, question: 'Does it make repeat/standing agents feel natural?' },
  { key: 'envFit', label: 'Env Fit', weight: 10, question: 'Does it explain custom setup, env keys, install commands, and repo conventions?' },
  { key: 'cloudLoop', label: 'Cloud Loop', weight: 10, question: 'Does it promise better remote iteration with guardrails, tests, reviewers, and stop conditions?' },
  { key: 'proof', label: 'Proof', weight: 10, question: 'Does it end in reviewable evidence: diffs, logs, screenshots, reports, or PRs?' },
  { key: 'truth', label: 'Shipping Truth', weight: 8, question: 'Can we say it without sounding fake or overclaiming current implementation?' },
  { key: 'clarity', label: 'Landing Clarity', weight: 8, question: 'Does the H1, hero visual, and CTA scan in under five seconds?' },
];

const score = (scores) => Number((rubric.reduce((sum, item) => sum + scores[item.key] * item.weight, 0) / 10).toFixed(1));

const candidate = (id, name, h1, thesis, basedOn, scores) => ({ id, name, h1, thesis, basedOn, scores, total: score(scores) });

const rounds = [
  {
    id: 'round-0',
    title: 'Round 0 - existing worktrees',
    prompt: 'Score the eight concepts already built as worktrees.',
    transition: 'The best concepts all make the remote agent feel personal. Browser-only is clear but not defensible; evidence is useful but not a wedge.',
    nextMove: 'Mutate toward portable Pi profile, browser launch, and reusable setup.',
    candidates: [
      candidate('R0-A', 'browser-pi', 'Run Pi in the browser.', 'Broad browser-first pitch; strong clarity, weaker uniqueness.', 'existing variant', { wedge: 7, portablePi: 5, browserRemote: 10, recurrence: 5, envFit: 5, cloudLoop: 6, proof: 7, truth: 8, clarity: 9 }),
      candidate('R0-B', 'bring-your-pi', 'Your local Pi setup. On a remote agent.', 'Best uniqueness; directly addresses local Pi skills and habits on remote agents.', 'existing variant', { wedge: 9, portablePi: 10, browserRemote: 6, recurrence: 5, envFit: 8, cloudLoop: 6, proof: 6, truth: 7, clarity: 8 }),
      candidate('R0-C', 'recurring-agents', 'Make Pi come back tomorrow.', 'Strong retention idea; not enough Pi-specific differentiation.', 'existing variant', { wedge: 7, portablePi: 5, browserRemote: 5, recurrence: 10, envFit: 5, cloudLoop: 7, proof: 6, truth: 7, clarity: 8 }),
      candidate('R0-D', 'env-capsules', 'Remote agents that know your setup.', 'Excellent env/setup story; less emotional than local Pi portability.', 'existing variant', { wedge: 7, portablePi: 7, browserRemote: 6, recurrence: 7, envFit: 10, cloudLoop: 7, proof: 6, truth: 8, clarity: 8 }),
      candidate('R0-E', 'cloud-loops', 'Better loops for cloud agents.', 'Strong operating model; less singular as a landing headline.', 'existing variant', { wedge: 7, portablePi: 5, browserRemote: 6, recurrence: 7, envFit: 6, cloudLoop: 10, proof: 8, truth: 6, clarity: 8 }),
      candidate('R0-F', 'setup-blueprint', 'Teach the cloud your dev setup once.', 'Good onboarding promise; reads like a feature more than the product.', 'existing variant', { wedge: 6, portablePi: 8, browserRemote: 5, recurrence: 8, envFit: 10, cloudLoop: 6, proof: 6, truth: 9, clarity: 7 }),
      candidate('R0-G', 'html-evidence', 'Not HTML artifacts. Evidence.', 'Important proof layer; too narrow as the main page.', 'existing variant', { wedge: 6, portablePi: 4, browserRemote: 5, recurrence: 4, envFit: 4, cloudLoop: 7, proof: 10, truth: 8, clarity: 7 }),
      candidate('R0-H', 'remote-roster', 'A bench of remote Pi agents.', 'Good product shape; needs setup portability to feel novel.', 'existing variant', { wedge: 7, portablePi: 6, browserRemote: 6, recurrence: 9, envFit: 7, cloudLoop: 7, proof: 7, truth: 7, clarity: 8 }),
    ],
  },
  {
    id: 'round-1',
    title: 'Round 1 - portable setup mutations',
    prompt: 'Generate ten concepts from the top Round 0 genes: bring-your-pi, env-capsules, and setup-blueprint.',
    transition: 'Passport language wins because it carries identity, permissions, and portability. The weak spot remains recurring usefulness.',
    nextMove: 'Keep profile portability and add standing agents plus evidence output.',
    candidates: [
      candidate('R1-A', 'Pi Passport', 'Give remote agents your Pi passport.', 'A profile bundle travels with each sandbox: skills, prompts, provider defaults, repo rules, and env recipe.', 'R0-B + R0-D + R0-F', { wedge: 8, portablePi: 10, browserRemote: 7, recurrence: 6, envFit: 9, cloudLoop: 7, proof: 7, truth: 7, clarity: 8 }),
      candidate('R1-B', 'Cloud Clone', 'Clone your Pi into the cloud.', 'High drama copy for syncing the local Pi experience into remote runners.', 'R0-B', { wedge: 8, portablePi: 10, browserRemote: 7, recurrence: 5, envFit: 8, cloudLoop: 7, proof: 6, truth: 6, clarity: 8 }),
      candidate('R1-C', 'Setup Backpack', 'Pack your setup once. Send it with every agent.', 'Setup is a portable backpack attached to each cloud run.', 'R0-D + R0-F', { wedge: 7, portablePi: 9, browserRemote: 6, recurrence: 7, envFit: 10, cloudLoop: 6, proof: 6, truth: 8, clarity: 7 }),
      candidate('R1-D', 'Browser Pi Plus Profile', 'Run Pi in the browser, with your profile attached.', 'Combines broad browser comprehension with local Pi profile sync.', 'R0-A + R0-B', { wedge: 8, portablePi: 8, browserRemote: 10, recurrence: 5, envFit: 7, cloudLoop: 6, proof: 7, truth: 8, clarity: 9 }),
      candidate('R1-E', 'Skill Sync Sandbox', 'Your skills in every remote sandbox.', 'Makes skills the hero rather than the broader Pi profile.', 'R0-B', { wedge: 8, portablePi: 10, browserRemote: 6, recurrence: 5, envFit: 8, cloudLoop: 6, proof: 7, truth: 7, clarity: 8 }),
      candidate('R1-F', 'Standing Profile', 'One profile for agents that come back.', 'Turns local Pi setup into the base layer for scheduled agents.', 'R0-B + R0-C', { wedge: 7, portablePi: 9, browserRemote: 6, recurrence: 9, envFit: 8, cloudLoop: 8, proof: 6, truth: 7, clarity: 7 }),
      candidate('R1-G', 'Personal Remote Runner', 'Remote agents that run like your Pi.', 'Plain-spoken personal remote runner promise.', 'R0-B + R0-H', { wedge: 8, portablePi: 8, browserRemote: 8, recurrence: 7, envFit: 8, cloudLoop: 7, proof: 7, truth: 8, clarity: 8 }),
      candidate('R1-H', 'Dotfiles in the Cloud', 'Your dotfiles, skills, and Pi in the cloud.', 'Too much dotfile overclaim, but names the local setup desire.', 'R0-D', { wedge: 7, portablePi: 8, browserRemote: 7, recurrence: 5, envFit: 9, cloudLoop: 6, proof: 6, truth: 5, clarity: 7 }),
      candidate('R1-I', 'Cloud Workbench for Pi', 'A cloud workbench for Pi agents.', 'Accurate but sounds category-generic.', 'R0-A + R0-E', { wedge: 6, portablePi: 7, browserRemote: 8, recurrence: 6, envFit: 7, cloudLoop: 7, proof: 7, truth: 9, clarity: 7 }),
      candidate('R1-J', 'Run Forever', 'Turn any Pi prompt into a recurring cloud run.', 'Great recurrence angle; local Pi profile is secondary.', 'R0-C + R0-E', { wedge: 7, portablePi: 7, browserRemote: 6, recurrence: 10, envFit: 8, cloudLoop: 8, proof: 7, truth: 6, clarity: 8 }),
    ],
  },
  {
    id: 'round-2',
    title: 'Round 2 - recurrence and proof graft',
    prompt: 'Generate ten concepts from Pi Passport, Personal Remote Runner, and Standing Profile.',
    transition: 'Personal Pi Cloud wins by making the product bigger than sync while preserving the local profile advantage.',
    nextMove: 'Sharpen the metaphor and add cloud-loop language without making the page abstract.',
    candidates: [
      candidate('R2-A', 'Personal Pi Cloud', 'A personal cloud for your Pi agents.', 'A named cloud space where remote agents inherit your Pi profile, run on schedule, and return evidence.', 'R1-A + R1-F + R1-G', { wedge: 9, portablePi: 10, browserRemote: 8, recurrence: 8, envFit: 9, cloudLoop: 8, proof: 8, truth: 7, clarity: 9 }),
      candidate('R2-B', 'Your Pi, On Schedule', 'Put your Pi setup on a schedule.', 'Best for recurring jobs, but the browser/cloud story is quieter.', 'R1-F + R1-J', { wedge: 8, portablePi: 9, browserRemote: 7, recurrence: 10, envFit: 8, cloudLoop: 8, proof: 7, truth: 7, clarity: 8 }),
      candidate('R2-C', 'Cloud Agents With Your Pi DNA', 'Cloud agents with your Pi DNA.', 'Memorable identity phrase; slightly gimmicky.', 'R1-A', { wedge: 8, portablePi: 10, browserRemote: 7, recurrence: 7, envFit: 8, cloudLoop: 7, proof: 8, truth: 6, clarity: 8 }),
      candidate('R2-D', 'Pi Profile, Remote Runs', 'Your Pi profile. Real remote runs.', 'Clear, shippable, and direct.', 'R1-A + R1-D', { wedge: 9, portablePi: 10, browserRemote: 8, recurrence: 6, envFit: 9, cloudLoop: 7, proof: 7, truth: 8, clarity: 9 }),
      candidate('R2-E', 'Remote Agent Memory', 'Remote agents that remember your setup.', 'Good retention metaphor, weaker Pi specificity.', 'R1-G', { wedge: 7, portablePi: 8, browserRemote: 7, recurrence: 8, envFit: 8, cloudLoop: 8, proof: 8, truth: 7, clarity: 7 }),
      candidate('R2-F', 'Clone Setup, Keep Control', 'Clone the setup. Keep the review.', 'Balanced between setup and human-approved evidence.', 'R1-B + R0-G', { wedge: 8, portablePi: 9, browserRemote: 7, recurrence: 7, envFit: 10, cloudLoop: 7, proof: 8, truth: 8, clarity: 8 }),
      candidate('R2-G', 'Browser Runs, Local Taste', 'Browser runs with local Pi taste.', 'High browser clarity, but the phrasing is too cute.', 'R1-D', { wedge: 8, portablePi: 9, browserRemote: 10, recurrence: 6, envFit: 8, cloudLoop: 7, proof: 7, truth: 8, clarity: 9 }),
      candidate('R2-H', 'Approved Autopilot', 'An autopilot that asks before it lands.', 'Strong cloud-loop guardrails; local setup underweighted.', 'R1-J + R0-E', { wedge: 7, portablePi: 8, browserRemote: 7, recurrence: 10, envFit: 8, cloudLoop: 9, proof: 8, truth: 6, clarity: 8 }),
      candidate('R2-I', 'Evidence First Pi Cloud', 'Every remote Pi run leaves receipts.', 'Excellent proof layer, not the primary wedge.', 'R0-G + R1-A', { wedge: 7, portablePi: 8, browserRemote: 8, recurrence: 7, envFit: 8, cloudLoop: 8, proof: 10, truth: 8, clarity: 8 }),
      candidate('R2-J', 'One Profile, Many Agents', 'One Pi profile. Many remote agents.', 'Simple product model, slightly less emotional.', 'R1-A + R0-H', { wedge: 8, portablePi: 10, browserRemote: 7, recurrence: 8, envFit: 8, cloudLoop: 7, proof: 7, truth: 7, clarity: 8 }),
    ],
  },
  {
    id: 'round-3',
    title: 'Round 3 - metaphor and operating loop',
    prompt: 'Generate ten concepts from Personal Pi Cloud plus the best clear/truthful alternatives.',
    transition: 'Brain/hands language wins: it explains local cognition plus remote execution in one line.',
    nextMove: 'Translate the metaphor into landing copy that does not sound like sci-fi.',
    candidates: [
      candidate('R3-A', 'Your Pi Brain, Cloud Hands', 'Your Pi brain. Cloud hands.', 'Your local Pi profile decides how work happens; remote sandboxes do the heavy lifting.', 'R2-A + R2-D', { wedge: 10, portablePi: 10, browserRemote: 8, recurrence: 8, envFit: 9, cloudLoop: 9, proof: 8, truth: 8, clarity: 9 }),
      candidate('R3-B', 'Pi That Leaves Your Laptop', 'Pi that can leave your laptop.', 'Strong mental image for browser/remote access.', 'R2-G', { wedge: 9, portablePi: 9, browserRemote: 9, recurrence: 7, envFit: 8, cloudLoop: 8, proof: 8, truth: 8, clarity: 9 }),
      candidate('R3-C', 'The Remote Agent That Knows You', 'The remote agent that knows your Pi setup.', 'Clear promise, but softer than brain/hands.', 'R2-A + R2-E', { wedge: 9, portablePi: 10, browserRemote: 7, recurrence: 8, envFit: 9, cloudLoop: 8, proof: 8, truth: 8, clarity: 9 }),
      candidate('R3-D', 'Cloud Loops, Local Rules', 'Cloud loops. Local Pi rules.', 'Excellent operating model for tests, reviewers, stop conditions, and setup.', 'R2-F + R2-H', { wedge: 8, portablePi: 9, browserRemote: 8, recurrence: 9, envFit: 10, cloudLoop: 10, proof: 8, truth: 8, clarity: 8 }),
      candidate('R3-E', 'Bring the Whole Pi Rig', 'Bring the whole Pi rig.', 'Good for power users, less clear to new visitors.', 'R2-C', { wedge: 8, portablePi: 10, browserRemote: 6, recurrence: 7, envFit: 10, cloudLoop: 7, proof: 7, truth: 7, clarity: 7 }),
      candidate('R3-F', 'Schedule Your Pi Clone', 'Schedule your Pi clone.', 'High recurrence, but clone language overpromises.', 'R2-B', { wedge: 8, portablePi: 9, browserRemote: 7, recurrence: 10, envFit: 8, cloudLoop: 8, proof: 7, truth: 7, clarity: 8 }),
      candidate('R3-G', 'One Click Remote Pi', 'One click to a remote Pi run.', 'Great conversion clarity, not enough defensibility.', 'R2-G', { wedge: 8, portablePi: 8, browserRemote: 10, recurrence: 6, envFit: 7, cloudLoop: 7, proof: 7, truth: 9, clarity: 9 }),
      candidate('R3-H', 'Pi Cloud With Receipts', 'A Pi cloud with receipts.', 'Makes evidence memorable and useful.', 'R2-I', { wedge: 8, portablePi: 9, browserRemote: 8, recurrence: 8, envFit: 8, cloudLoop: 8, proof: 10, truth: 8, clarity: 8 }),
      candidate('R3-I', 'Private Pi Profile Cloud', 'A private cloud for your Pi profile.', 'Good trust posture, less action-oriented.', 'R2-A', { wedge: 8, portablePi: 10, browserRemote: 7, recurrence: 7, envFit: 9, cloudLoop: 7, proof: 7, truth: 9, clarity: 8 }),
      candidate('R3-J', 'Remote Workers For Your Pi', 'Remote workers for your Pi.', 'Plain but risks sounding like generic worker infrastructure.', 'R2-J', { wedge: 7, portablePi: 8, browserRemote: 8, recurrence: 8, envFit: 8, cloudLoop: 8, proof: 8, truth: 8, clarity: 7 }),
    ],
  },
  {
    id: 'round-4',
    title: 'Round 4 - landing headline stress test',
    prompt: 'Generate ten landing-ready headlines from the best Round 3 concepts.',
    transition: 'Follows-you language beats brain/hands because it is warmer, clearer, and still implies portability.',
    nextMove: 'Finalize around the follows-you headline and verify it can carry the proof sections.',
    candidates: [
      candidate('R4-A', 'Your Pi follows you to the cloud', 'Your Pi follows you to the cloud.', 'The local Pi setup becomes a portable profile for browser-launched remote agents.', 'R3-A + R3-C', { wedge: 10, portablePi: 10, browserRemote: 9, recurrence: 8, envFit: 9, cloudLoop: 9, proof: 9, truth: 8, clarity: 10 }),
      candidate('R4-B', 'Run your Pi from any browser', 'Run your Pi from any browser.', 'The broadest top-of-funnel sentence, with profile sync as support.', 'R3-B + R3-G', { wedge: 9, portablePi: 9, browserRemote: 10, recurrence: 7, envFit: 8, cloudLoop: 8, proof: 9, truth: 9, clarity: 10 }),
      candidate('R4-C', 'Cloud agents, your local brain', 'Cloud agents. Your local Pi brain.', 'Keeps the strong metaphor but sounds more technical.', 'R3-A', { wedge: 10, portablePi: 10, browserRemote: 8, recurrence: 8, envFit: 9, cloudLoop: 9, proof: 8, truth: 8, clarity: 9 }),
      candidate('R4-D', 'Standing cloud agents with your Pi profile', 'Standing cloud agents with your Pi profile.', 'Best for recurring jobs, too long for the main H1.', 'R3-D + R3-F', { wedge: 9, portablePi: 10, browserRemote: 8, recurrence: 10, envFit: 9, cloudLoop: 9, proof: 8, truth: 7, clarity: 9 }),
      candidate('R4-E', 'Browser control plane for personal Pi', 'The browser control plane for personal Pi agents.', 'Accurate product category, less emotional.', 'R3-G + R3-I', { wedge: 8, portablePi: 9, browserRemote: 10, recurrence: 8, envFit: 9, cloudLoop: 8, proof: 8, truth: 9, clarity: 8 }),
      candidate('R4-F', 'Teach the cloud your Pi once', 'Teach the cloud your Pi setup once.', 'Excellent setup promise; narrower than the final product.', 'R3-D + R3-E', { wedge: 9, portablePi: 10, browserRemote: 7, recurrence: 8, envFit: 10, cloudLoop: 8, proof: 7, truth: 9, clarity: 9 }),
      candidate('R4-G', 'Your Pi setup, rented remote hands', 'Your Pi setup. Remote hands.', 'Memorable but "rented" cheapens the trust signal.', 'R3-A', { wedge: 8, portablePi: 10, browserRemote: 8, recurrence: 7, envFit: 9, cloudLoop: 9, proof: 8, truth: 7, clarity: 8 }),
      candidate('R4-H', 'Pi cloud runs with a paper trail', 'Pi cloud runs with a paper trail.', 'Great proof framing, weaker main wedge.', 'R3-H', { wedge: 8, portablePi: 9, browserRemote: 8, recurrence: 8, envFit: 8, cloudLoop: 9, proof: 10, truth: 9, clarity: 8 }),
      candidate('R4-I', 'Recurring fixes from a cloud Pi', 'Ship recurring fixes from a cloud Pi.', 'Strong use case, but sounds too autonomous.', 'R3-F + R3-H', { wedge: 8, portablePi: 8, browserRemote: 8, recurrence: 10, envFit: 8, cloudLoop: 9, proof: 9, truth: 7, clarity: 8 }),
      candidate('R4-J', 'No generic remote agents', 'Stop using generic remote agents.', 'Good contrast copy, but negative as the first impression.', 'R3-C', { wedge: 9, portablePi: 10, browserRemote: 7, recurrence: 7, envFit: 8, cloudLoop: 8, proof: 8, truth: 8, clarity: 9 }),
    ],
  },
  {
    id: 'round-5',
    title: 'Round 5 - final ten',
    prompt: 'Generate ten final candidates from the winning headline and stress them against truth, proof, and conversion clarity.',
    transition: 'The final winner keeps the warm follows-you H1, then lets browser, recurring agents, env capsules, cloud loops, and evidence act as proof.',
    nextMove: 'Implement a landing page around the winner.',
    candidates: [
      candidate('R5-A', 'Your Pi follows you to the cloud.', 'Your Pi follows you to the cloud.', 'Remote coding agents launched from the browser, carrying your local Pi profile, recurring schedules, env setup, cloud loops, and evidence packs.', 'R4-A', { wedge: 10, portablePi: 10, browserRemote: 9, recurrence: 9, envFit: 9, cloudLoop: 9, proof: 9, truth: 9, clarity: 10 }),
      candidate('R5-B', 'Run your own Pi from the browser.', 'Run your own Pi from the browser.', 'Stronger browser conversion, but slightly less unique than follows-you profile portability.', 'R4-B', { wedge: 9, portablePi: 10, browserRemote: 10, recurrence: 8, envFit: 9, cloudLoop: 8, proof: 9, truth: 8, clarity: 10 }),
      candidate('R5-C', 'Remote agents with your local Pi setup.', 'Remote agents with your local Pi setup.', 'Plainest truthful version of the wedge.', 'R4-A + R4-F', { wedge: 10, portablePi: 10, browserRemote: 8, recurrence: 8, envFit: 10, cloudLoop: 9, proof: 9, truth: 9, clarity: 9 }),
      candidate('R5-D', 'A personal cloud for Pi agents.', 'A personal cloud for Pi agents.', 'Good product category, but less immediate than follows-you.', 'R2-A + R4-A', { wedge: 9, portablePi: 10, browserRemote: 9, recurrence: 9, envFit: 9, cloudLoop: 9, proof: 8, truth: 8, clarity: 9 }),
      candidate('R5-E', 'Make Pi recurring, remote, and yours.', 'Make Pi recurring, remote, and yours.', 'Balanced feature list, less visual as a hero line.', 'R4-D', { wedge: 9, portablePi: 9, browserRemote: 8, recurrence: 10, envFit: 9, cloudLoop: 9, proof: 8, truth: 8, clarity: 9 }),
      candidate('R5-F', 'Your Pi brain, always on.', 'Your Pi brain, always on.', 'Sticky but risks overpromising autonomy.', 'R3-A + R4-D', { wedge: 9, portablePi: 10, browserRemote: 7, recurrence: 10, envFit: 8, cloudLoop: 9, proof: 8, truth: 7, clarity: 9 }),
      candidate('R5-G', 'The agent cloud that remembers your setup.', 'The agent cloud that remembers your setup.', 'Trustworthy setup memory, weaker Pi specificity.', 'R2-E + R4-F', { wedge: 8, portablePi: 9, browserRemote: 8, recurrence: 9, envFit: 10, cloudLoop: 8, proof: 8, truth: 9, clarity: 8 }),
      candidate('R5-H', 'Cloud worktrees, local Pi rules.', 'Cloud worktrees. Local Pi rules.', 'Developer-specific and accurate, but too implementation-facing.', 'R3-D', { wedge: 8, portablePi: 9, browserRemote: 8, recurrence: 8, envFit: 10, cloudLoop: 9, proof: 9, truth: 9, clarity: 8 }),
      candidate('R5-I', 'Pi in the browser, powered by your profile.', 'Pi in the browser, powered by your profile.', 'Very clear, but longer and less distinctive.', 'R4-B + R4-A', { wedge: 9, portablePi: 10, browserRemote: 10, recurrence: 8, envFit: 9, cloudLoop: 8, proof: 8, truth: 8, clarity: 9 }),
      candidate('R5-J', 'Stop rebuilding agent setup.', 'Stop rebuilding agent setup.', 'Best pain-point line for a section, not the whole landing page.', 'R4-F', { wedge: 8, portablePi: 9, browserRemote: 7, recurrence: 8, envFit: 10, cloudLoop: 8, proof: 8, truth: 10, clarity: 8 }),
    ],
  },
];

const keyLabels = {
  wedge: 'W',
  portablePi: 'P',
  browserRemote: 'B',
  recurrence: 'R',
  envFit: 'E',
  cloudLoop: 'L',
  proof: 'V',
  truth: 'T',
  clarity: 'C',
};

const topCandidates = rounds.map((round) => {
  const [winner] = [...round.candidates].sort((a, b) => b.total - a.total);
  return { round: round.title, winner: winner.name, h1: winner.h1, total: winner.total, nextMove: round.nextMove };
});

const finalWinner = rounds.at(-1).candidates.find((item) => item.id === 'R5-A');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function scoreBar(total) {
  return `<span class="scorebar" style="--score:${total}"><span></span><b>${total.toFixed(1)}</b></span>`;
}

function scoreBreakdown(candidate) {
  return Object.entries(candidate.scores)
    .map(([key, value]) => `<span title="${escapeHtml(rubric.find((item) => item.key === key).label)}">${keyLabels[key]}${value}</span>`)
    .join('');
}

function tableRows(round) {
  return [...round.candidates]
    .sort((a, b) => b.total - a.total)
    .map((item, index) => `<tr class="${index === 0 ? 'winner' : ''}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)} from ${escapeHtml(item.basedOn)}</small></td>
      <td>${escapeHtml(item.h1)}</td>
      <td>${escapeHtml(item.thesis)}</td>
      <td>${scoreBreakdown(item)}</td>
      <td>${scoreBar(item.total)}</td>
    </tr>`)
    .join('\n');
}

function makeReport() {
  const roundBlocks = rounds.map((round) => {
    const winner = [...round.candidates].sort((a, b) => b.total - a.total)[0];
    return `<section class="round" id="${round.id}">
      <div class="round-head">
        <div>
          <p class="eyebrow">${escapeHtml(round.id)}</p>
          <h2>${escapeHtml(round.title)}</h2>
          <p>${escapeHtml(round.prompt)}</p>
        </div>
        <div class="winner-chip"><span>winner</span><strong>${escapeHtml(winner.name)}</strong>${scoreBar(winner.total)}</div>
      </div>
      <div class="transition">
        <p><strong>What changed:</strong> ${escapeHtml(round.transition)}</p>
        <p><strong>Next mutation:</strong> ${escapeHtml(round.nextMove)}</p>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Concept</th><th>H1</th><th>Thesis</th><th>Rubric</th><th>Total</th></tr></thead>
        <tbody>${tableRows(round)}</tbody>
      </table></div>
    </section>`;
  }).join('\n');

  const rubricRows = rubric.map((item) => `<tr><td><strong>${escapeHtml(item.label)}</strong><code>${escapeHtml(item.key)}</code></td><td>${item.weight}</td><td>${escapeHtml(item.question)}</td></tr>`).join('\n');
  const ladderItems = topCandidates.map((item, index) => `<li>
      <span>${index}</span>
      <div><strong>${escapeHtml(item.winner)}</strong><p>${escapeHtml(item.h1)}</p></div>
      <b>${item.total.toFixed(1)}</b>
    </li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Remote Pi landing scoring loop</title>
  <style>
    :root { --paper:#fbfaf6; --ink:#1b1713; --muted:#62584d; --line:#ded8cc; --line-2:#c9bfae; --blue:#195c9f; --green:#17634a; --amber:#a16207; --rose:#9f1239; --panel:#fffefb; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:32px 0 64px; }
    header { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:28px; align-items:end; padding:26px 0 32px; border-bottom:1px solid var(--line); }
    h1 { margin:0; max-width:850px; font-size:clamp(46px,7vw,90px); line-height:.88; letter-spacing:-.07em; }
    h2 { margin:0 0 8px; font-size:28px; line-height:1; letter-spacing:-.04em; }
    p { margin:0; color:var(--muted); }
    .eyebrow { margin:0 0 8px; color:var(--blue); font-size:11px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
    .summary { display:grid; gap:10px; padding:14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .summary div { display:flex; align-items:center; justify-content:space-between; gap:14px; border-bottom:1px solid var(--line); padding-bottom:8px; }
    .summary div:last-child { border:0; padding-bottom:0; }
    .summary b { color:var(--ink); font-size:20px; }
    .summary span { color:var(--muted); font-weight:700; }
    .rubric { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,420px); gap:18px; margin-top:18px; align-items:start; }
    .panel { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:16px; }
    table { width:100%; border-collapse:collapse; }
    th, td { border-bottom:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    td small { display:block; margin-top:3px; color:var(--muted); font-size:12px; }
    code { display:inline-block; margin-left:8px; padding:1px 5px; border:1px solid var(--line); border-radius:5px; color:var(--blue); background:#f5f8fb; font:12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ladder { list-style:none; display:grid; gap:10px; margin:0; padding:0; }
    .ladder li { display:grid; grid-template-columns:30px minmax(0,1fr) 52px; gap:10px; align-items:center; padding:10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .ladder li span { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:var(--ink); color:var(--paper); font-weight:900; }
    .ladder li p { font-size:13px; }
    .round { margin-top:26px; padding-top:24px; border-top:1px solid var(--line); }
    .round-head { display:grid; grid-template-columns:minmax(0,1fr) 260px; gap:18px; align-items:start; }
    .winner-chip { display:grid; gap:8px; border:1px solid var(--line-2); border-radius:8px; background:#f1f7f2; padding:12px; }
    .winner-chip span { color:var(--green); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; }
    .winner-chip strong { font-size:22px; line-height:1; letter-spacing:-.04em; }
    .transition { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0; }
    .transition p { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:12px; }
    .transition strong { color:var(--ink); }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .round table { min-width:880px; }
    .winner td { background:#f4fbf6; }
    .scorebar { display:grid; grid-template-columns:minmax(80px,1fr) 46px; gap:8px; align-items:center; min-width:132px; }
    .scorebar span { height:8px; border-radius:999px; background:linear-gradient(90deg,var(--green) calc(var(--score) * 1%), #e7e2d7 0); border:1px solid var(--line); }
    .scorebar b { font-variant-numeric:tabular-nums; }
    td:nth-child(5) { min-width:190px; }
    td:nth-child(5) span { display:inline-block; min-width:32px; margin:0 4px 4px 0; padding:2px 5px; border:1px solid var(--line); border-radius:5px; color:var(--muted); background:#faf7ef; font:12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .final { margin-top:28px; display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:18px; align-items:stretch; }
    .final .panel { background:#101722; color:#f8fafc; border-color:#263242; }
    .final p { color:#cbd5e1; }
    .final a { display:inline-flex; margin-top:18px; min-height:42px; align-items:center; border-radius:7px; background:#8ee3b2; color:#07111e; padding:0 14px; font-weight:900; text-decoration:none; }
    @media (max-width:860px) { header, .rubric, .round-head, .transition, .final { grid-template-columns:1fr; } h1 { font-size:52px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">remote pi landing loop</p>
        <h1>Five rounds from eight variants to one landing page.</h1>
      </div>
      <aside class="summary" aria-label="Scoring summary">
        <div><span>Rubric criteria</span><b>${rubric.length}</b></div>
        <div><span>Starting variants</span><b>${rounds[0].candidates.length}</b></div>
        <div><span>Generated concepts</span><b>${rounds.slice(1).reduce((sum, round) => sum + round.candidates.length, 0)}</b></div>
        <div><span>Winner</span><b>${finalWinner.total.toFixed(1)}</b></div>
      </aside>
    </header>
    <section class="rubric">
      <div class="panel">
        <p class="eyebrow">rubric</p>
        <h2>What we should optimize for</h2>
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Criterion</th><th>Weight</th><th>Question</th></tr></thead>
          <tbody>${rubricRows}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <p class="eyebrow">step by step</p>
        <h2>Winner progression</h2>
        <ol class="ladder">${ladderItems}</ol>
      </div>
    </section>
    ${roundBlocks}
    <section class="final">
      <div class="panel">
        <p class="eyebrow">final decision</p>
        <h2>${escapeHtml(finalWinner.h1)}</h2>
        <p>${escapeHtml(finalWinner.thesis)}</p>
        <a href="./remote-pi-final-landing.html">Open final landing page</a>
      </div>
      <div class="panel">
        <p class="eyebrow">why it won</p>
        <p>It preserves the unique local Pi setup wedge, keeps browser remote access obvious, adds recurring agents as retention, and supports trust with env recipes, human approval, and evidence packs.</p>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function makeFinalLanding() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Spanner - Your Pi follows you to the cloud</title>
  <meta name="description" content="Run remote Pi agents from the browser with your local Pi profile, setup recipe, recurring schedules, cloud loops, and evidence packs.">
  <link rel="icon" href="./favicon.svg">
  <style>
    :root { --ink:#171412; --muted:#5e554c; --paper:#fbfaf7; --panel:#fffefb; --line:#ddd6ca; --line-strong:#bfb4a4; --blue:#155ea8; --green:#17634a; --amber:#b7791f; --night:#101722; --night-2:#172230; --mint:#8ee3b2; --sky:#9fc9ff; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; min-height:100vh; background:var(--paper); color:var(--ink); font:16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; background:linear-gradient(90deg, rgba(21,94,168,.06) 1px, transparent 1px), linear-gradient(180deg, rgba(23,99,74,.05) 1px, transparent 1px); background-size:48px 48px; mask-image:linear-gradient(to bottom, #000, transparent 72%); }
    main { position:relative; width:min(1180px, calc(100% - 32px)); margin:0 auto; }
    nav { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:24px 0; }
    .brand { display:inline-flex; align-items:center; gap:10px; color:inherit; text-decoration:none; font-weight:950; letter-spacing:-.05em; }
    .brand img { width:30px; height:30px; image-rendering:pixelated; }
    .nav-actions { display:flex; align-items:center; gap:10px; }
    .nav-actions a { color:var(--muted); font-size:14px; font-weight:800; text-decoration:none; }
    .hero { min-height:calc(100svh - 78px); display:grid; grid-template-columns:minmax(0,1fr) minmax(360px,460px); gap:clamp(28px,6vw,78px); align-items:center; padding:38px 0 66px; }
    .eyebrow { margin:0 0 12px; color:var(--green); font-size:11px; font-weight:950; letter-spacing:.14em; text-transform:uppercase; }
    h1 { max-width:850px; margin:0; font-size:clamp(60px,8.8vw,118px); line-height:.83; letter-spacing:-.085em; }
    .lede { max-width:720px; margin:22px 0 0; color:var(--muted); font-size:clamp(20px,2.3vw,26px); line-height:1.28; font-weight:650; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:32px; }
    .button { display:inline-flex; min-height:48px; align-items:center; justify-content:center; border:1px solid var(--blue); border-radius:7px; background:var(--blue); color:#fff; padding:0 18px; font-weight:900; text-decoration:none; text-transform:lowercase; }
    .button.secondary { background:var(--panel); color:var(--blue); border-color:var(--line-strong); }
    .hero-proof { display:grid; gap:12px; padding:14px; border:1px solid var(--line-strong); border-radius:8px; background:var(--night); color:#f8fafc; box-shadow:0 28px 80px rgba(16,23,34,.2); }
    .proof-top { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#cbd5e1; font-size:12px; font-weight:850; }
    .signal { display:grid; grid-template-columns:1fr auto 1fr; gap:10px; align-items:stretch; }
    .profile, .sandbox { display:grid; gap:8px; border:1px solid #263242; border-radius:8px; background:var(--night-2); padding:12px; min-height:210px; }
    .signal h2 { margin:0; color:#fff; font-size:24px; line-height:1; letter-spacing:-.05em; }
    .tag { display:inline-flex; width:max-content; border:1px solid #344256; border-radius:999px; padding:5px 8px; color:#cbd5e1; font-size:12px; font-weight:850; }
    .arrow { display:grid; place-items:center; color:var(--mint); font-weight:950; }
    .run { border:1px solid #344256; border-radius:8px; background:#0b111a; padding:12px; }
    .run code { color:var(--mint); font:13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .status-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .metric { border:1px solid #344256; border-radius:8px; padding:10px; background:#0b111a; }
    .metric b { display:block; color:#fff; font-size:18px; line-height:1; }
    .metric span { color:#9aa8b9; font-size:12px; font-weight:750; }
    .below-fold { margin-top:-44px; padding-bottom:72px; }
    .strip { display:flex; flex-wrap:wrap; gap:8px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:14px 0; color:var(--muted); font-weight:850; }
    .strip span { color:var(--ink); }
    .section { padding:54px 0 0; }
    .section-head { display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,360px); gap:24px; align-items:end; margin-bottom:18px; }
    .section h2 { margin:0; font-size:clamp(34px,5vw,62px); line-height:.9; letter-spacing:-.07em; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .card { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:18px; min-height:168px; }
    .card b { display:block; margin-bottom:10px; font-size:22px; line-height:1; letter-spacing:-.04em; }
    .card p { margin:0; color:var(--muted); font-weight:560; }
    .loop-panel { display:grid; grid-template-columns:1.1fr .9fr; gap:14px; }
    .timeline { display:grid; gap:10px; counter-reset:step; }
    .step { display:grid; grid-template-columns:38px minmax(0,1fr); gap:12px; align-items:start; border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:12px; counter-increment:step; }
    .step::before { content:counter(step); display:grid; place-items:center; width:32px; height:32px; border-radius:50%; background:var(--ink); color:#fff; font-weight:900; }
    .step b { display:block; margin-bottom:3px; }
    .evidence { border:1px solid var(--line-strong); border-radius:8px; background:#f3f8f5; padding:16px; }
    .evidence h3 { margin:0 0 12px; font-size:30px; line-height:.95; letter-spacing:-.055em; }
    .evidence-list { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .evidence-list span { border:1px solid #c8d8cf; border-radius:7px; background:#fff; padding:10px; color:var(--green); font-weight:900; }
    footer { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:60px; padding:24px 0; border-top:1px solid var(--line); color:var(--muted); font-size:14px; font-weight:700; }
    footer a { color:var(--blue); font-weight:900; text-decoration:none; }
    @media (max-width:900px) { main { width:min(100% - 24px, 1180px); } nav, footer, .section-head { align-items:flex-start; flex-direction:column; } .hero, .grid, .loop-panel, .section-head { grid-template-columns:1fr; } .signal { grid-template-columns:1fr; } .arrow { min-height:24px; transform:rotate(90deg); } .status-grid, .evidence-list { grid-template-columns:1fr; } h1 { font-size:56px; } .button { width:100%; } .below-fold { margin-top:0; } }
  </style>
</head>
<body>
  <main>
    <nav aria-label="Spanner navigation">
      <a class="brand" href="./"><img src="./logo-mark.svg" alt="" aria-hidden="true"><span>spanner</span></a>
      <div class="nav-actions"><a href="./remote-pi-landing-loop.html">scoring loop</a><a href="./">web app</a></div>
    </nav>
    <section class="hero" aria-labelledby="title">
      <div>
        <p class="eyebrow">remote pi agents</p>
        <h1 id="title">Your Pi follows you to the cloud.</h1>
        <p class="lede">Start a remote coding agent from the browser, but keep the setup that makes Pi yours: skills, prompts, AGENTS.md habits, provider defaults, env recipes, recurring schedules, and reviewable evidence.</p>
        <div class="actions">
          <a class="button" href="./">start with my Pi profile</a>
          <a class="button secondary" href="#proof">see the run loop</a>
        </div>
      </div>
      <aside class="hero-proof" aria-label="Remote Pi run preview">
        <div class="proof-top"><span>spanner.run/agent/pi-profile</span><span>remote ready</span></div>
        <div class="signal">
          <div class="profile">
            <p class="eyebrow">local pi</p>
            <h2>Your setup</h2>
            <span class="tag">skills</span><span class="tag">prompts</span><span class="tag">AGENTS.md</span><span class="tag">models</span><span class="tag">env recipe</span>
          </div>
          <div class="arrow">-></div>
          <div class="sandbox">
            <p class="eyebrow">cloud sandbox</p>
            <h2>Remote hands</h2>
            <div class="run"><code>pi run "audit auth nightly"</code></div>
            <span class="tag">repo worktree</span><span class="tag">tests</span><span class="tag">diff</span>
          </div>
        </div>
        <div class="status-grid">
          <div class="metric"><b>1 click</b><span>make recurring</span></div>
          <div class="metric"><b>9 keys</b><span>env allowlist</span></div>
          <div class="metric"><b>4 files</b><span>evidence pack</span></div>
        </div>
      </aside>
    </section>
    <div class="below-fold" id="proof">
      <div class="strip"><span>Browser Pi</span> local profile sync <span>recurring runs</span> env capsules <span>cloud loops</span> evidence packs human approval</div>
      <section class="section">
        <div class="section-head">
          <h2>Not a generic remote agent.</h2>
          <p>Your cloud agent should start with the same working context as your local Pi. The browser is only the control plane; your profile is the product wedge.</p>
        </div>
        <div class="grid">
          <article class="card"><b>Portable Pi profile</b><p>Package skills, prompts, AGENTS.md, provider defaults, and repo rules into each remote run.</p></article>
          <article class="card"><b>Setup once</b><p>Save env keys to forward, install commands, checks, package managers, and branch habits as a reusable capsule.</p></article>
          <article class="card"><b>Make it recurring</b><p>Turn any prompt into a standing agent for nightly audits, weekly cleanup, release notes, or dependency reviews.</p></article>
        </div>
      </section>
      <section class="section">
        <div class="section-head">
          <h2>The loop is the landing page.</h2>
          <p>People trust remote agents when they can see the loop: setup, run, check, review, and only then ship.</p>
        </div>
        <div class="loop-panel">
          <div class="timeline">
            <div class="step"><div><b>Launch from browser</b><p>Pick a repo, choose a Pi profile, and start the sandbox.</p></div></div>
            <div class="step"><div><b>Run with local rules</b><p>The agent uses your profile, env capsule, checks, and stop conditions.</p></div></div>
            <div class="step"><div><b>Repeat on schedule</b><p>Promote a good prompt into a daily, weekly, or event-triggered run.</p></div></div>
            <div class="step"><div><b>Review the evidence</b><p>Open diffs, logs, screenshots, decisions, failed attempts, and next actions.</p></div></div>
          </div>
          <aside class="evidence">
            <p class="eyebrow">run evidence</p>
            <h3>Every cloud run leaves receipts.</h3>
            <div class="evidence-list">
              <span>diff</span><span>test log</span><span>screenshot</span><span>decision note</span><span>PR draft</span><span>next action</span>
            </div>
          </aside>
        </div>
      </section>
    </div>
    <footer>
      <span>Final concept from the five-round rubric loop.</span>
      <a href="./remote-pi-landing-loop.html">view scoring report</a>
    </footer>
  </main>
</body>
</html>`;
}

const payload = {
  generatedAt: '2026-07-12',
  rubric,
  rounds,
  topCandidates,
  finalWinner,
};

await mkdir(path.join(root, 'data'), { recursive: true });
await mkdir(path.join(root, 'frontend/public'), { recursive: true });
await writeFile(path.join(root, 'data/remote-pi-landing-loop.json'), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(path.join(root, 'frontend/public/remote-pi-landing-loop.html'), makeReport());
await writeFile(path.join(root, 'frontend/public/remote-pi-final-landing.html'), makeFinalLanding());
