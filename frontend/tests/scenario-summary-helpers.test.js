/**
 * OpenShift Airgap Architect - Scenario Summary Helpers Tests
 *
 * Tests for live-updating scenario summary dropdown helpers.
 * Verifies tab confirmation logic, content builders, and security exclusions.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isTabConfirmed,
  getConfirmedTabs,
  buildIdentitySummary,
  buildNetworkingSummary,
  buildConnectivitySummary,
  buildTrustProxySummary,
  buildPlatformSummary,
  buildHostInventorySummary,
  buildOperatorsSummary,
  buildDocumentationSources
} from '../src/scenarioSummaryHelpers.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import docsIndex420 from '../src/data/docs-index/4.20.json';
import docsIndex421 from '../src/data/docs-index/4.21.json';

const HELPERS_SOURCE_PATH = resolve('src/scenarioSummaryHelpers.js');

// Mock getScenarioId to avoid importing the whole helper
vi.mock('../src/hostInventoryV2Helpers.js', () => ({
  getScenarioId: (platform, method) => {
    if (platform === 'VMware vSphere' && method === 'IPI') return 'vsphere-ipi';
    if (platform === 'Bare Metal' && method === 'Agent-Based Installer') return 'bare-metal-agent';
    return null;
  }
}));

describe('Scenario Summary Helpers', () => {
  describe('isTabConfirmed', () => {
    it('returns false when state is null', () => {
      expect(isTabConfirmed(null, 'blueprint')).toBe(false);
    });

    it('returns false when tab is not visited', () => {
      const state = {
        ui: { visitedSteps: {} },
        reviewFlags: {}
      };
      expect(isTabConfirmed(state, 'blueprint')).toBe(false);
    });

    it('returns false when tab is flagged for review', () => {
      const state = {
        ui: { visitedSteps: { blueprint: true } },
        reviewFlags: { blueprint: true }
      };
      expect(isTabConfirmed(state, 'blueprint')).toBe(false);
    });

    it('returns false when tab has validation errors', () => {
      const state = {
        ui: { visitedSteps: { blueprint: true } },
        reviewFlags: {},
        blueprint: { platform: '', method: '' } // Missing required fields
      };
      expect(isTabConfirmed(state, 'blueprint')).toBe(false);
    });

    it('returns true when tab is visited, not flagged, and validation passes', () => {
      const state = {
        ui: { visitedSteps: { blueprint: true } },
        reviewFlags: {},
        blueprint: {
          platform: 'vsphere',
          method: 'ipi',
          confirmed: true
        },
        version: {
          selectedVersion: '4.20.0'
        }
      };
      expect(isTabConfirmed(state, 'blueprint')).toBe(true);
    });
  });

  describe('getConfirmedTabs', () => {
    it('returns empty array when no tabs confirmed', () => {
      const state = {
        ui: { visitedSteps: {} },
        reviewFlags: {}
      };
      expect(getConfirmedTabs(state)).toEqual([]);
    });

    it('returns only confirmed tabs', () => {
      const state = {
        ui: {
          visitedSteps: {
            blueprint: true,
            'identity-access': true,
            networking: true
          }
        },
        reviewFlags: {
          networking: true // This one is flagged
        },
        blueprint: {
          platform: 'vsphere',
          method: 'ipi',
          confirmed: true,
          clusterName: 'test-cluster',
          baseDomain: 'example.com',
          blueprintPullSecretEphemeral: '{"auths":{"cloud.openshift.com":{"auth":"test"}}}'
        },
        version: {
          selectedVersion: '4.20.0'
        },
        credentials: {
          pullSecretPlaceholder: '{"auths":{"cloud.openshift.com":{"auth":"test"}}}'
        }
      };
      const confirmed = getConfirmedTabs(state);
      expect(confirmed).toContain('blueprint');
      expect(confirmed).toContain('identity-access');
      expect(confirmed).not.toContain('networking'); // Flagged for review
    });
  });

  describe('buildIdentitySummary', () => {
    it('shows default values when state fields not present', () => {
      const state = {};
      const summary = buildIdentitySummary(state);
      // FIPS and SSH still shown with default values even if credentials not present
      expect(summary).toContain('FIPS mode: Disabled');
      expect(summary).toContain('SSH key: Not configured');
    });

    it('includes FIPS mode status', () => {
      const state = {
        globalStrategy: { fips: true }
      };
      const summary = buildIdentitySummary(state);
      expect(summary).toContain('FIPS mode: Enabled');
    });

    it('includes SSH key configured status', () => {
      const state = {
        credentials: { sshPublicKey: 'ssh-ed25519 AAAA...' }
      };
      const summary = buildIdentitySummary(state);
      expect(summary).toContain('SSH key: Configured');
    });

    it('NEVER includes actual pull secret content', () => {
      const state = {
        blueprint: {
          blueprintPullSecretEphemeral: '{"auths":{"registry.redhat.io":{"auth":"BASE64SECRET123"}}}'
        },
        credentials: {}
      };
      const summary = buildIdentitySummary(state);
      const joined = summary.join(' ');
      expect(joined).not.toContain('auths');
      expect(joined).not.toContain('BASE64SECRET123');
      expect(joined).not.toMatch(/\{.*auth.*\}/); // No JSON with auth
      expect(joined).toContain('Pull secret source: Red Hat');
    });

    it('detects Red Hat + Mirror registry pull secrets', () => {
      const state = {
        blueprint: {
          blueprintPullSecretEphemeral: '{}'
        },
        credentials: {
          mirrorRegistryPullSecret: '{}'
        }
      };
      const summary = buildIdentitySummary(state);
      expect(summary).toContain('Pull secret source: Red Hat + Mirror registry');
    });
  });

  describe('buildNetworkingSummary', () => {
    it('returns null when networking not present', () => {
      const state = {};
      expect(buildNetworkingSummary(state)).toBeNull();
    });

    it('includes network topology for single-stack IPv4', () => {
      const state = {
        globalStrategy: {
          networking: {
            clusterNetworkCidr: '10.128.0.0/14'
          }
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Topology: Single-stack IPv4');
    });

    it('includes network topology for dual-stack', () => {
      const state = {
        globalStrategy: {
          networking: {
            clusterNetworkCidr: '10.128.0.0/14',
            clusterNetworkCidrV6: 'fd01::/48'
          }
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Topology: Dual-stack (IPv4 + IPv6)');
    });

    it('includes cluster and service network CIDRs', () => {
      const state = {
        globalStrategy: {
          networking: {
            clusterNetworkCidr: '10.128.0.0/14',
            serviceNetworkCidr: '172.30.0.0/16'
          }
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Cluster network: 10.128.0.0/14');
      expect(summary).toContain('Service network: 172.30.0.0/16');
    });

    it('includes VIPs when configured', () => {
      const state = {
        hostInventory: {
          apiVip: '192.168.1.100',
          ingressVip: '192.168.1.101'
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('API VIP: 192.168.1.100');
      expect(summary).toContain('Ingress VIP: 192.168.1.101');
    });
  });

  describe('buildConnectivitySummary', () => {
    it('returns null when no connectivity configured', () => {
      const state = {};
      expect(buildConnectivitySummary(state)).toBeNull();
    });

    it('includes NTP server count (not actual servers)', () => {
      const state = {
        globalStrategy: {
          ntpServers: ['time.example.com', 'time2.example.com', 'time3.example.com']
        }
      };
      const summary = buildConnectivitySummary(state);
      expect(summary).toContain('NTP servers: 3 configured');
      expect(summary.join(' ')).not.toContain('time.example.com'); // Security: no actual servers
    });

    it('includes mirror registry FQDN (not credentials)', () => {
      const state = {
        globalStrategy: {
          mirroring: {
            registryFqdn: 'registry.corp.local:5000'
          }
        },
        credentials: {
          usingMirrorRegistry: true,
          mirrorRegistryUnauthenticated: false
        }
      };
      const summary = buildConnectivitySummary(state);
      expect(summary).toContain('Mirror registry: registry.corp.local:5000 (authenticated)');
    });

    it('NEVER includes mirror registry credentials', () => {
      const state = {
        globalStrategy: {
          mirroring: {
            registryFqdn: 'registry.corp.local:5000'
          }
        },
        credentials: {
          usingMirrorRegistry: true,
          mirrorRegistryPullSecret: '{"auths":{"registry.corp.local":{"auth":"SECRETKEY123"}}}'
        }
      };
      const summary = buildConnectivitySummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('SECRETKEY123');
      expect(joined).not.toContain('auths');
    });
  });

  describe('buildTrustProxySummary', () => {
    it('returns null when no trust/proxy configured', () => {
      const state = {};
      expect(buildTrustProxySummary(state)).toBeNull();
    });

    it('includes proxy status with type', () => {
      const state = {
        globalStrategy: {
          proxyEnabled: true,
          proxies: {
            httpProxy: 'http://proxy.corp.local:8080',
            httpsProxy: 'https://proxy.corp.local:8443'
          }
        }
      };
      const summary = buildTrustProxySummary(state);
      expect(summary).toContain('Corporate proxy: Enabled (HTTP + HTTPS)');
    });

    it('includes trust bundle policy', () => {
      const state = {
        trust: {
          additionalTrustBundlePolicy: 'Always'
        }
      };
      const summary = buildTrustProxySummary(state);
      expect(summary).toContain('Trust bundle policy: Always');
    });

    it('includes CA bundle counts with sources (not actual certs)', () => {
      const state = {
        trust: {
          mirrorRegistryCaPem: '-----BEGIN CERTIFICATE-----\nMIIFake...',
          proxyCaPem: '-----BEGIN CERTIFICATE-----\nMIIFake2...'
        }
      };
      const summary = buildTrustProxySummary(state);
      expect(summary).toContain('CA bundles: 2 configured (mirror + proxy)');
      const joined = summary.join(' ');
      expect(joined).not.toContain('BEGIN CERTIFICATE'); // Security: no actual certs
      expect(joined).not.toContain('MIIFake');
    });
  });

  describe('buildPlatformSummary', () => {
    it('returns null when platform not present', () => {
      const state = {};
      expect(buildPlatformSummary(state)).toBeNull();
    });

    it('includes vSphere details', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        platformSpecifics: {
          vcenter: 'vcenter.corp.local',
          datacenter: 'DC1',
          cluster: 'Production',
          datastore: 'vsanDatastore'
        }
      };
      const summary = buildPlatformSummary(state);
      expect(summary).toContain('vCenter: vcenter.corp.local');
      expect(summary).toContain('Datacenter: DC1');
      expect(summary).toContain('Cluster: Production');
      expect(summary).toContain('Datastore: vsanDatastore');
    });

    it('includes AWS details with instance types', () => {
      const state = {
        blueprint: { platform: 'AWS' },
        platformConfig: {
          aws: {
            region: 'us-east-1',
            controlPlaneInstanceType: 'm5.xlarge',
            workerInstanceType: 'm5.2xlarge',
            zones: ['us-east-1a', 'us-east-1b', 'us-east-1c']
          }
        }
      };
      const summary = buildPlatformSummary(state);
      expect(summary).toContain('Region: us-east-1');
      expect(summary).toContain('Control plane instance type: m5.xlarge');
      expect(summary).toContain('Worker instance type: m5.2xlarge');
      expect(summary).toContain('Availability zones: us-east-1a, us-east-1b, us-east-1c');
    });

    it('NEVER includes vCenter passwords', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        platformSpecifics: {
          vcenter: 'vcenter.corp.local'
        },
        platformConfig: {
          vsphere: {
            username: 'administrator@vsphere.local',
            password: 'SuperSecret123!'
          }
        }
      };
      const summary = buildPlatformSummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('SuperSecret123!');
      expect(joined).not.toContain('administrator@vsphere.local');
    });
  });

  describe('buildHostInventorySummary', () => {
    it('returns null when no inventory', () => {
      const state = {};
      expect(buildHostInventorySummary(state)).toBeNull();
    });

    it('includes node counts by role for agent-based inventory', () => {
      const state = {
        hostInventory: {
          nodes: [
            { hostname: 'master1', role: 'master' },
            { hostname: 'master2', role: 'master' },
            { hostname: 'master3', role: 'master' },
            { hostname: 'worker1', role: 'worker' },
            { hostname: 'worker2', role: 'worker' }
          ]
        }
      };
      const summary = buildHostInventorySummary(state);
      expect(summary).toContain('Total nodes: 5 (3 control plane, 2 workers)');
    });

    it('includes node counts from platform config replicas (IPI)', () => {
      const state = {
        platformConfig: {
          controlPlaneReplicas: 3,
          computeReplicas: 5
        }
      };
      const summary = buildHostInventorySummary(state);
      expect(summary).toContain('Total nodes: 8 (3 control plane, 5 workers)');
    });
  });

  describe('buildOperatorsSummary', () => {
    it('returns null when no operators selected', () => {
      const state = {};
      expect(buildOperatorsSummary(state)).toBeNull();
    });

    it('includes operator count and catalog breakdown', () => {
      const state = {
        operators: {
          selected: [
            { name: 'op1', catalog: 'Red Hat' },
            { name: 'op2', catalog: 'Red Hat' },
            { name: 'op3', catalog: 'Red Hat' },
            { name: 'op4', catalog: 'Certified' },
            { name: 'op5', catalog: 'Certified' },
            { name: 'op6', catalog: 'Community' }
          ]
        }
      };
      const summary = buildOperatorsSummary(state);
      expect(summary).toContain('6 operators selected');
      expect(summary).toContain('Catalogs: Red Hat (3), Certified (2), Community (1)');
    });
  });

  describe('buildDocumentationSources', () => {
    it('returns empty array when no docs index', () => {
      const state = { blueprint: { platform: 'VMware vSphere' }, methodology: { method: 'IPI' } };
      const docs = buildDocumentationSources(state, [], null);
      expect(docs).toEqual([]);
    });

    it('includes base scenario docs', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        methodology: { method: 'IPI' }
      };
      const docsIndex = {
        scenarios: {
          'vsphere-ipi': {
            docs: [
              { title: 'Installing on vSphere', url: 'https://docs.openshift.com/vsphere-ipi' }
            ]
          }
        }
      };
      const docs = buildDocumentationSources(state, [], docsIndex);
      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe('Installing on vSphere');
    });

    it('adds FIPS doc when FIPS enabled and identity-access confirmed', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        methodology: { method: 'IPI' },
        globalStrategy: { fips: true }
      };
      const docs = buildDocumentationSources(state, ['identity-access'], docsIndex420);
      const fipsDoc = docs.find(d => d.title === 'Enabling FIPS mode');
      expect(fipsDoc).toBeDefined();
      expect(fipsDoc.url).toBe('https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installation_overview/installing-fips');
    });

    it('adds dual-stack doc when dual-stack configured and networking confirmed', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        methodology: { method: 'IPI' },
        globalStrategy: {
          networking: {
            clusterNetworkCidr: '10.128.0.0/14',
            clusterNetworkCidrV6: 'fd01::/48'
          }
        }
      };
      const docs = buildDocumentationSources(state, ['networking-v2'], docsIndex420);
      const dualStackDoc = docs.find(d => d.title === 'Configuring dual-stack networking');
      expect(dualStackDoc).toBeDefined();
      expect(dualStackDoc.url).toBe('https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure');
    });

    it('adds mirror registry doc when mirror registry used and connectivity confirmed', () => {
      const state = {
        blueprint: { platform: 'Generic' },
        methodology: { method: 'Generic' },
        credentials: { usingMirrorRegistry: true }
      };
      const docs = buildDocumentationSources(state, ['connectivity-mirroring'], docsIndex420);
      const mirrorDoc = docs.find(d => d.title === 'Mirroring images for a disconnected installation');
      expect(mirrorDoc).toBeDefined();
      expect(mirrorDoc.url).toBe('https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index');
    });

    it('adds proxy doc when proxy enabled and trust-proxy confirmed', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        methodology: { method: 'IPI' },
        globalStrategy: { proxyEnabled: true }
      };
      const docs = buildDocumentationSources(state, ['trust-proxy'], docsIndex420);
      const proxyDoc = docs.find(d => d.title === 'Configuring corporate proxy for disconnected clusters');
      expect(proxyDoc).toBeDefined();
      expect(proxyDoc.url).toBe('https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic#installation-configure-proxy_installing-platform-agnostic');
    });

    it('deduplicates docs by URL', () => {
      const state = {
        blueprint: { platform: 'VMware vSphere' },
        methodology: { method: 'IPI' }
      };
      const docsIndex = {
        scenarios: {
          'vsphere-ipi': {
            docs: [
              { title: 'Doc 1', url: 'https://example.com/same' },
              { title: 'Doc 2', url: 'https://example.com/same' } // Duplicate URL
            ]
          }
        }
      };
      const docs = buildDocumentationSources(state, [], docsIndex);
      expect(docs).toHaveLength(1);
    });
  });

  describe('Version-aware conditional documentation links (DOC-102 Slice 5J)', () => {
    const CONDITIONAL_LINK_EXPECTATIONS = [
      {
        title: 'Enabling FIPS mode',
        docId: 'installing-fips',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installation_overview/installing-fips',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installation_overview/installing-fips',
      },
      {
        title: 'Configuring dual-stack networking',
        docId: 'configuring-dual-stack',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_bare_metal/user-provisioned-infrastructure',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_bare_metal/user-provisioned-infrastructure',
      },
      {
        title: 'Mirroring images for a disconnected installation',
        docId: 'about-oc-mirror-v2',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/disconnected_environments/index',
      },
      {
        title: 'Configuring NTP servers for disconnected clusters',
        docId: 'configuring-ntp-chrony',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_an_on-premise_cluster_with_the_agent-based_installer/preparing-to-install-with-agent-based-installer',
      },
      {
        title: 'Configuring corporate proxy for disconnected clusters',
        docId: 'configuring-cluster-wide-proxy',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_any_platform/installing-platform-agnostic#installation-configure-proxy_installing-platform-agnostic',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/installing_on_any_platform/installing-platform-agnostic#installation-configure-proxy_installing-platform-agnostic',
      },
      {
        title: 'Configuring additional trust bundles',
        docId: 'configuring-custom-pki',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/security_and_compliance/configuring-certificates',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/security_and_compliance/configuring-certificates',
      },
      {
        title: 'Installing Operators in disconnected environments',
        docId: 'olm-restricted-networks',
        url420: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/operators/administrator-tasks#olm-restricted-networks',
        url421: 'https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/operators/administrator-tasks#olm-restricted-networks',
      },
    ];

    const CONDITIONAL_LINK_TITLES = CONDITIONAL_LINK_EXPECTATIONS.map(e => e.title);

    function stateWithAllConditionals() {
      return {
        blueprint: { platform: 'Bare Metal' },
        methodology: { method: 'Agent-Based Installer' },
        globalStrategy: {
          fips: true,
          networking: {
            clusterNetworkCidr: '10.128.0.0/14',
            clusterNetworkCidrV6: 'fd01::/48'
          },
          ntpServers: ['time.example.com'],
          proxyEnabled: true
        },
        credentials: { usingMirrorRegistry: true },
        trust: { mirrorRegistryCaPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----' },
        operators: { selected: [{ name: 'op1', catalog: 'Red Hat' }] }
      };
    }

    const ALL_TABS = ['identity-access', 'networking-v2', 'connectivity-mirroring', 'trust-proxy', 'operators'];

    function stateWithAllConditionalsNoScenario() {
      return {
        ...stateWithAllConditionals(),
        blueprint: { platform: 'Generic' },
        methodology: { method: 'Generic' },
      };
    }

    describe.each(CONDITIONAL_LINK_EXPECTATIONS)('$title', ({ title, url420, url421 }) => {
      it('4.20 index → exact verified URL', () => {
        const docs = buildDocumentationSources(stateWithAllConditionalsNoScenario(), ALL_TABS, docsIndex420);
        const doc = docs.find(d => d.title === title);
        expect(doc).toBeDefined();
        expect(doc.url).toBe(url420);
        expect(doc.url).toContain('/4.20/');
        expect(doc.url).not.toContain('/4.21/');
      });

      it('4.21 index → exact verified URL', () => {
        const docs = buildDocumentationSources(stateWithAllConditionalsNoScenario(), ALL_TABS, docsIndex421);
        const doc = docs.find(d => d.title === title);
        expect(doc).toBeDefined();
        expect(doc.url).toBe(url421);
        expect(doc.url).toContain('/4.21/');
        expect(doc.url).not.toContain('/4.20/');
      });

      it('null index → link is not added', () => {
        const docs = buildDocumentationSources(stateWithAllConditionalsNoScenario(), ALL_TABS, null);
        const doc = docs.find(d => d.title === title);
        expect(doc).toBeUndefined();
      });
    });

    it('all 7 conditional docs present with 4.20 index', () => {
      const docs = buildDocumentationSources(stateWithAllConditionalsNoScenario(), ALL_TABS, docsIndex420);
      for (const { title } of CONDITIONAL_LINK_EXPECTATIONS) {
        expect(docs.find(d => d.title === title)).toBeDefined();
      }
    });

    it('all 7 conditional docs present with 4.21 index', () => {
      const docs = buildDocumentationSources(stateWithAllConditionalsNoScenario(), ALL_TABS, docsIndex421);
      for (const { title } of CONDITIONAL_LINK_EXPECTATIONS) {
        expect(docs.find(d => d.title === title)).toBeDefined();
      }
    });

    it('base scenario documentation uses the selected index', () => {
      const docs420 = buildDocumentationSources(stateWithAllConditionals(), [], docsIndex420);
      const scenarioDocs420 = docs420.filter(d => !CONDITIONAL_LINK_TITLES.includes(d.title));
      expect(scenarioDocs420.length).toBeGreaterThan(0);
      for (const d of scenarioDocs420) {
        expect(d.url).toContain('/4.20/');
        expect(d.url).not.toContain('/4.21/');
      }

      const docs421 = buildDocumentationSources(stateWithAllConditionals(), [], docsIndex421);
      const scenarioDocs421 = docs421.filter(d => !CONDITIONAL_LINK_TITLES.includes(d.title));
      expect(scenarioDocs421.length).toBeGreaterThan(0);
      for (const d of scenarioDocs421) {
        expect(d.url).toContain('/4.21/');
        expect(d.url).not.toContain('/4.20/');
      }
    });

    it('deduplication still works with version-aware links', () => {
      const fipsUrl = docsIndex420.sharedDocs.find(d => d.id === 'installing-fips').url;
      const indexWithDupe = {
        ...docsIndex420,
        scenarios: {
          'bare-metal-agent': {
            docs: [
              { title: 'Enabling FIPS mode', url: fipsUrl }
            ]
          }
        }
      };
      const state = stateWithAllConditionals();
      const docs = buildDocumentationSources(state, ['identity-access'], indexWithDupe);
      const fipsDocs = docs.filter(d => d.url === fipsUrl);
      expect(fipsDocs).toHaveLength(1);
    });

    it('null index produces no scenario docs and no conditional docs', () => {
      const docs = buildDocumentationSources(stateWithAllConditionals(), ALL_TABS, null);
      expect(docs).toHaveLength(0);
    });

    it('docsIndex with no sharedDocs produces no conditional docs', () => {
      const indexNoShared = {
        version: '4.20',
        scenarios: {
          'bare-metal-agent': {
            docs: [{ title: 'test', url: 'https://example.com' }]
          }
        }
      };
      const docs = buildDocumentationSources(stateWithAllConditionals(), ALL_TABS, indexNoShared);
      const conditionalTitles = docs.filter(d => CONDITIONAL_LINK_TITLES.includes(d.title));
      expect(conditionalTitles).toHaveLength(0);
    });

    it('missing sharedDocs mapping adds no conditional link', () => {
      const indexPartialShared = {
        version: '4.20',
        sharedDocs: [
          { id: 'installing-fips', title: 'FIPS', url: 'https://example.com/fips' }
        ],
        scenarios: { 'bare-metal-agent': { docs: [] } }
      };
      const docs = buildDocumentationSources(stateWithAllConditionals(), ALL_TABS, indexPartialShared);
      const fipsDoc = docs.find(d => d.title === 'Enabling FIPS mode');
      expect(fipsDoc).toBeDefined();
      const otherConditionals = docs.filter(d =>
        CONDITIONAL_LINK_TITLES.includes(d.title) && d.title !== 'Enabling FIPS mode'
      );
      expect(otherConditionals).toHaveLength(0);
    });
  });

  describe('Source contract: no baseUrl suffix concatenation (DOC-102)', () => {
    it('production code does not concatenate ${baseUrl}html/ for conditional links', () => {
      const source = readFileSync(HELPERS_SOURCE_PATH, 'utf-8');
      expect(source).not.toMatch(/\$\{baseUrl\}html\//);
    });

    it('production code uses getSharedDocUrl for all conditional doc lookups', () => {
      const source = readFileSync(HELPERS_SOURCE_PATH, 'utf-8');
      expect(source).toMatch(/getSharedDocUrl/);
      expect(source).toMatch(/sharedUrl\(/);
    });
  });

  describe('Security: NEVER includes sensitive data', () => {
    it('NEVER includes pull secrets in any summary', () => {
      const state = {
        blueprint: {
          blueprintPullSecretEphemeral: '{"auths":{"registry.redhat.io":{"auth":"BASE64SECRET"}}}'
        },
        credentials: {
          mirrorRegistryPullSecret: '{"auths":{"mirror.local":{"auth":"ANOTHERSECRET"}}}'
        },
        networking: {},
        globalStrategy: {},
        trust: {},
        inventory: {},
        operators: {}
      };

      const allSummaries = [
        buildIdentitySummary(state),
        buildNetworkingSummary(state),
        buildConnectivitySummary(state),
        buildTrustProxySummary(state),
        buildPlatformSummary(state),
        buildHostInventorySummary(state),
        buildOperatorsSummary(state)
      ];

      const joined = allSummaries.filter(Boolean).flat().join(' ');
      expect(joined).not.toContain('BASE64SECRET');
      expect(joined).not.toContain('ANOTHERSECRET');
      expect(joined).not.toContain('"auths"');
    });

    it('NEVER includes SSH private keys', () => {
      const state = {
        credentials: {
          sshPublicKey: 'ssh-ed25519 AAAA...',
          sshPrivateKeyEphemeral: '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET'
        }
      };

      const summary = buildIdentitySummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('BEGIN OPENSSH PRIVATE KEY');
      expect(joined).not.toContain('SECRET');
      expect(joined).toContain('SSH key: Configured'); // Safe status only
    });

    it('NEVER includes CA certificate contents', () => {
      const state = {
        trust: {
          mirrorRegistryCaPem: '-----BEGIN CERTIFICATE-----\nMIICertContent123\n-----END CERTIFICATE-----',
          proxyCaPem: '-----BEGIN CERTIFICATE-----\nMIICertContent456\n-----END CERTIFICATE-----'
        }
      };

      const summary = buildTrustProxySummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('BEGIN CERTIFICATE');
      expect(joined).not.toContain('MIICertContent123');
      expect(joined).not.toContain('MIICertContent456');
      expect(joined).toContain('CA bundles:'); // Safe count only
    });

    it('NEVER includes vCenter passwords', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        platformConfig: {
          vsphere: {
            username: 'administrator@vsphere.local',
            password: 'vCenterPassword123!'
          }
        },
        platformSpecifics: {
          vcenter: 'vcenter.corp.local'
        }
      };

      const summary = buildPlatformSummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('vCenterPassword123!');
      expect(joined).not.toContain('administrator@vsphere.local');
    });
  });
});
