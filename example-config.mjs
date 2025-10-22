import { Config } from './dist/packages/config/index.js';
import { fileURLToPath } from 'node:url';

function fixturePath(name) {
  return fileURLToPath(new URL(`./packages/mcp/test/fixtures/${name}`, import.meta.url));
}

const config = new Config({
  profile: {
    name: 'Example Corp',
    legalName: 'Example Corporation LLC',
    website: 'https://example.com',
    contactEmail: 'oss@example.com',
    securityEmail: 'security@example.com'
  },
  licenses: {
    green: [
      {
        id: 'Apache-2.0',
        name: 'Apache License 2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0'
      },
      {
        id: 'MIT',
        name: 'MIT License',
        url: 'https://opensource.org/license/mit/'
      }
    ],
    yellow: [
      {
        id: 'GPL-3.0',
        name: 'GNU General Public License v3.0',
        notes: 'Requires source disclosure when distributing derivative works.'
      }
    ],
    red: [
      {
        id: 'SSPL-1.0',
        name: 'Server Side Public License',
        notes: 'Not approved for use in Example Corp products.'
      }
    ]
  },
  resources: [
    { name: 'LICENSE', path: fixturePath('LICENSE') },
    { name: 'SECURITY.md', path: fixturePath('SECURITY.md') }
  ],
  instructions: [
    {
      name: 'review',
      content: [
        'Perform an OSS review for {{ profile.name }}.',
        'Highlight licensing risks, security disclosures, and documentation gaps.'
      ].join('\n')
    },
    {
      name: 'release-checklist',
      summary: 'Ensure core governance artifacts are present before release.',
      content: [
        '- Confirm LICENSE and SECURITY.md resources exist and render correctly.',
        '- Verify contact emails route to active distribution lists.',
        '- Document any variances from corporate OSS policy.'
      ].join('\n')
    }
  ],
  detection: {
    'sensitive-links': [
      {
        id: 'internal-wiki-url',
        title: 'Internal wiki reference',
        match: 'https?://wiki\\.example\\.com',
        type: 'regex',
        severity: 'high',
        remediation: 'Replace internal wiki references with public documentation.'
      }
    ],
    secrets: [
      {
        id: 'pem-key-block',
        title: 'PEM private key block',
        match: '-----BEGIN PRIVATE KEY-----',
        type: 'keyword',
        severity: 'critical',
        remediation: 'Remove private keys before committing and rotate credentials.'
      }
    ]
  }
});

export default config;

