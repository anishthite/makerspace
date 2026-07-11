export const report = {
  generatedAt: '2026-07-10',
  defaultRecommendation: 'Use Cloudflare Sandboxes through a Worker broker for cloud Pi execution; keep the Node control plane as the single browser-facing backend.',
  rationale: [
    'Cloudflare Sandboxes are faster to wake for this workload and fit the existing Pi bridge contract through exposed ports.',
    'The Worker broker owns @cloudflare/sandbox, Durable Objects, Container bindings, and R2-backed backups.',
    'The Node app keeps sessions, auth, SSE relay, and provider contract unchanged above the adapter layer.',
  ],
  comparison: [
    {
      dimension: 'Lifecycle API',
      cloudflare: 'Worker broker creates, executes in, backs up, restores, and destroys sandboxes.',
      vps: 'You own Docker, proxying, cleanup, and host sizing.',
      verdict: 'cloudflare',
    },
    {
      dimension: 'Bridge access',
      cloudflare: 'Sandbox exposed ports route the Pi bridge back to the control backend.',
      vps: 'You configure TLS, routing, and per-session access yourself.',
      verdict: 'cloudflare',
    },
    {
      dimension: 'Remote tools',
      cloudflare: 'Broker exec and file APIs back bash/read/write/edit tools.',
      vps: 'SSH can work but couples tools to host networking and key management.',
      verdict: 'cloudflare',
    },
  ],
  v0Architecture: {
    transport: 'Use a Cloudflare Worker broker around @cloudflare/sandbox for sandbox lifecycle, process execution, file transfer, backups, and port exposure.',
    controlPlane: [
      'Browser talks only to the Node backend.',
      'File-backed session metadata in data/sessions.json or D1.',
      'Cloudflare-backed provider with bridge and host-dispatch modes.',
    ],
    runner: [
      'Create or reuse a Cloudflare sandbox by session label.',
      'Restore saved backups when resuming a sleeping or deleted workspace.',
      'Run the setup script inside the sandbox through broker exec.',
      'Clone a remote repo or initialize an empty repo.',
      'Start the Pi bridge and expose it through a Cloudflare sandbox port URL.',
    ],
    browser: [
      'Submit prompts to Node endpoints.',
      'Stream runs through the control backend over SSE.',
      'Keep Cloudflare and broker credentials on the backend only.',
    ],
  },
  sources: [
    { label: 'Cloudflare Sandbox SDK', url: 'https://developers.cloudflare.com/sandbox/' },
    { label: 'Cloudflare Sandbox backup and restore', url: 'https://developers.cloudflare.com/sandbox/guides/backup-restore/' },
    { label: 'pi README', url: 'https://www.npmjs.com/package/@earendil-works/pi-coding-agent' },
  ],
};
