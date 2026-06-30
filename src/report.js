export const report = {
  generatedAt: '2026-06-17',
  defaultRecommendation: 'Use Daytona sandboxes for cloud Pi execution and keep the Node control plane as the single browser-facing backend.',
  rationale: [
    'Daytona gives the app an SDK-backed sandbox lifecycle instead of shelling out to a provider CLI.',
    'Preview URLs let the control backend keep the existing Pi bridge HTTP/SSE contract.',
    'Process and filesystem SDK APIs let host-dispatch tools run inside the sandbox without raw SSH.',
  ],
  comparison: [
    {
      dimension: 'Lifecycle API',
      daytona: 'SDK create/list/delete and lifecycle intervals live in app code.',
      vps: 'You own Docker, proxying, cleanup, and host sizing.',
      verdict: 'daytona',
    },
    {
      dimension: 'Bridge access',
      daytona: 'Preview URLs expose the bridge port to the control backend with a preview token.',
      vps: 'You configure TLS, routing, and per-session access yourself.',
      verdict: 'daytona',
    },
    {
      dimension: 'Remote tools',
      daytona: 'Process and filesystem APIs back bash/read/write/edit tools.',
      vps: 'SSH can work but couples tools to host networking and key management.',
      verdict: 'daytona',
    },
  ],
  v0Architecture: {
    transport: 'Use @daytona/sdk for sandbox lifecycle, preview links, process execution, and file transfer.',
    controlPlane: [
      'Single Node process serving JSON + static files.',
      'File-backed session metadata in data/sessions.json.',
      'Daytona-backed provider with bridge and host-dispatch modes.',
    ],
    runner: [
      'Create or reuse a Daytona sandbox by session label.',
      'Run the setup script inside the sandbox with Daytona process execution.',
      'Clone a remote repo or initialize an empty repo.',
      'Start the Pi bridge and expose it through a Daytona preview link.',
    ],
    frontend: [
      'Create repo-backed cloud Pi agents.',
      'Stream runs through the control backend over SSE.',
      'Keep Daytona credentials on the backend only.',
    ],
    missingByDesign: [
      'No email/password auth; hosted users sign in with GitHub OAuth.',
      'No embedded terminal.',
      'No local repo upload/sync.',
    ],
  },
  sources: [
    { label: 'Daytona TypeScript SDK', url: 'https://www.daytona.io/docs/typescript-sdk.md' },
    { label: 'Daytona preview URLs', url: 'https://www.daytona.io/docs/en/preview' },
    { label: 'pi README', url: 'https://www.npmjs.com/package/@earendil-works/pi-coding-agent' },
  ],
};
