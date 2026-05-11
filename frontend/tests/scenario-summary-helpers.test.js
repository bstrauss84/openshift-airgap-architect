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

import { describe, it, expect } from 'vitest';
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
    it('returns null when credentials not present', () => {
      const state = {};
      expect(buildIdentitySummary(state)).toBeNull();
    });

    it('includes FIPS mode status', () => {
      const state = {
        credentials: { fipsMode: true }
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
        networking: {
          clusterNetwork: '10.128.0.0/14'
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Topology: Single-stack IPv4');
    });

    it('includes network topology for dual-stack', () => {
      const state = {
        networking: {
          clusterNetwork: '10.128.0.0/14',
          clusterNetworkV6: 'fd01::/48'
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Topology: Dual-stack (IPv4 + IPv6)');
    });

    it('includes cluster and service network CIDRs', () => {
      const state = {
        networking: {
          clusterNetwork: '10.128.0.0/14',
          serviceNetwork: '172.30.0.0/16'
        }
      };
      const summary = buildNetworkingSummary(state);
      expect(summary).toContain('Cluster network: 10.128.0.0/14');
      expect(summary).toContain('Service network: 172.30.0.0/16');
    });

    it('includes VIPs when configured', () => {
      const state = {
        networking: {
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
        connectivity: {
          ntpServers: ['time.example.com', 'time2.example.com', 'time3.example.com']
        }
      };
      const summary = buildConnectivitySummary(state);
      expect(summary).toContain('NTP servers: 3 configured');
      expect(summary.join(' ')).not.toContain('time.example.com'); // Security: no actual servers
    });

    it('includes mirror registry FQDN (not credentials)', () => {
      const state = {
        mirroring: {
          useMirrorRegistry: true,
          registryFqdn: 'registry.corp.local:5000'
        },
        credentials: {
          mirrorRegistryUnauthenticated: false
        }
      };
      const summary = buildConnectivitySummary(state);
      expect(summary).toContain('Mirror registry: registry.corp.local:5000 (authenticated)');
    });

    it('NEVER includes mirror registry credentials', () => {
      const state = {
        mirroring: {
          useMirrorRegistry: true,
          registryFqdn: 'registry.corp.local:5000'
        },
        credentials: {
          mirrorRegistryPullSecret: '{"auths":{"registry.corp.local":{"auth":"secret"}}}'
        }
      };
      const summary = buildConnectivitySummary(state);
      const joined = summary ? summary.join(' ') : '';
      expect(joined).not.toContain('secret');
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
        strategy: {
          proxyEnabled: true,
          httpProxy: 'http://proxy.corp.local:8080',
          httpsProxy: 'https://proxy.corp.local:8443'
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
        credentials: {
          mirrorRegistryCert: '-----BEGIN CERTIFICATE-----\nMIIFake...'
        },
        trust: {
          additionalTrustBundle: '-----BEGIN CERTIFICATE-----\nMIIFake2...'
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
        blueprint: { platform: 'vsphere' },
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

    it('includes AWS details', () => {
      const state = {
        blueprint: { platform: 'aws' },
        platformSpecifics: {
          region: 'us-east-1',
          instanceType: 'm5.xlarge'
        }
      };
      const summary = buildPlatformSummary(state);
      expect(summary).toContain('Region: us-east-1');
      expect(summary).toContain('Instance type: m5.xlarge');
    });

    it('NEVER includes vCenter passwords', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
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

    it('includes node counts by role', () => {
      const state = {
        inventory: {
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
      const state = { blueprint: { platform: 'vsphere' }, methodology: { method: 'ipi' } };
      const docs = buildDocumentationSources(state, [], null);
      expect(docs).toEqual([]);
    });

    it('includes base scenario docs', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' }
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
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' },
        credentials: { fipsMode: true }
      };
      const docs = buildDocumentationSources(state, ['identity-access'], {});
      const fipsDoc = docs.find(d => d.title === 'Enabling FIPS mode');
      expect(fipsDoc).toBeDefined();
    });

    it('adds dual-stack doc when dual-stack configured and networking confirmed', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' },
        networking: {
          clusterNetwork: '10.128.0.0/14',
          clusterNetworkV6: 'fd01::/48'
        }
      };
      const docs = buildDocumentationSources(state, ['networking'], {});
      const dualStackDoc = docs.find(d => d.title === 'Configuring dual-stack networking');
      expect(dualStackDoc).toBeDefined();
    });

    it('adds mirror registry doc when mirror registry used and connectivity confirmed', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' },
        mirroring: { useMirrorRegistry: true }
      };
      const docs = buildDocumentationSources(state, ['connectivity-mirroring'], {});
      const mirrorDoc = docs.find(d => d.title === 'Mirroring images for a disconnected installation');
      expect(mirrorDoc).toBeDefined();
    });

    it('adds proxy doc when proxy enabled and trust-proxy confirmed', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' },
        strategy: { proxyEnabled: true }
      };
      const docs = buildDocumentationSources(state, ['trust-proxy'], {});
      const proxyDoc = docs.find(d => d.title === 'Configuring corporate proxy for disconnected clusters');
      expect(proxyDoc).toBeDefined();
    });

    it('deduplicates docs by URL', () => {
      const state = {
        blueprint: { platform: 'vsphere' },
        methodology: { method: 'ipi' }
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
        mirroring: {},
        strategy: {},
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
        credentials: {
          mirrorRegistryCert: '-----BEGIN CERTIFICATE-----\nMIICertContent123\n-----END CERTIFICATE-----'
        },
        trust: {
          additionalTrustBundle: '-----BEGIN CERTIFICATE-----\nMIICertContent456\n-----END CERTIFICATE-----'
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
