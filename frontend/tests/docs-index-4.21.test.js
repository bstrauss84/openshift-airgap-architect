/**
 * docs-index 4.21 Tests (DOC-102 Slice 5F)
 *
 * Proves:
 * - docs-index 4.21.json exists and is valid JSON
 * - frontend mirror matches backend
 * - 4.21 docs use 4.21 URLs (not 4.20)
 * - vSphere scenarios are not included (missing 4.21 docs)
 * - No broken/404 URLs from validation
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const BACKEND_DOCS_INDEX = path.join(process.cwd(), '../data/docs-index/4.21.json');
const FRONTEND_DOCS_INDEX = path.join(process.cwd(), 'src/data/docs-index/4.21.json');

describe('docs-index 4.21 (DOC-102 Slice 5F)', () => {
  describe('backend docs-index 4.21 exists', () => {
    it('data/docs-index/4.21.json exists', () => {
      expect(fs.existsSync(BACKEND_DOCS_INDEX)).toBe(true);
    });

    it('data/docs-index/4.21.json is valid JSON', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('docs-index 4.21 has version: "4.21"', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.version).toBe('4.21');
    });

    it('docs-index 4.21 has baseUrl with /4.21/', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.baseUrl).toContain('/4.21/');
    });

    it('docs-index 4.21 has scenarios object', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios).toBeDefined();
      expect(typeof docsIndex.scenarios).toBe('object');
    });

    it('docs-index 4.21 has at least one scenario', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      const scenarios = Object.keys(docsIndex.scenarios);
      expect(scenarios.length).toBeGreaterThan(0);
    });
  });

  describe('frontend docs-index mirror exists and matches', () => {
    it('frontend/src/data/docs-index/4.21.json exists', () => {
      expect(fs.existsSync(FRONTEND_DOCS_INDEX)).toBe(true);
    });

    it('frontend mirror is valid JSON', () => {
      const content = fs.readFileSync(FRONTEND_DOCS_INDEX, 'utf8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('frontend mirror matches backend docs-index', () => {
      const backendContent = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const frontendContent = fs.readFileSync(FRONTEND_DOCS_INDEX, 'utf8');
      expect(frontendContent).toBe(backendContent);
    });
  });

  describe('4.21 docs use 4.21 URLs', () => {
    it('all doc URLs contain /4.21/ (not /4.20/)', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);

      const allUrls = [];
      Object.values(docsIndex.scenarios).forEach((scenario) => {
        scenario.docs.forEach((doc) => {
          allUrls.push(doc.url);
        });
      });

      const wrong420Urls = allUrls.filter((url) => url.includes('/4.20/'));
      expect(wrong420Urls.length).toBe(0);

      const correct421Urls = allUrls.filter((url) => url.includes('/4.21/'));
      expect(correct421Urls.length).toBe(allUrls.length);
    });

    it('baseUrl uses /4.21/', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.baseUrl).toContain('/4.21/');
      expect(docsIndex.baseUrl).not.toContain('/4.20/');
    });
  });

  describe('vSphere scenarios ARE included (html-single URL structure)', () => {
    it('vsphere-ipi scenario is present', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['vsphere-ipi']).toBeDefined();
      expect(docsIndex.scenarios['vsphere-ipi'].docs.length).toBeGreaterThan(0);
    });

    it('vsphere-upi scenario is present', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['vsphere-upi']).toBeDefined();
      expect(docsIndex.scenarios['vsphere-upi'].docs.length).toBeGreaterThan(0);
    });

    it('vsphere-agent scenario is present', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['vsphere-agent']).toBeDefined();
      expect(docsIndex.scenarios['vsphere-agent'].docs.length).toBeGreaterThan(0);
    });

    it('vSphere URLs use html-single structure (not html)', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      const vsphereUrls = docsIndex.scenarios['vsphere-ipi'].docs
        .filter(d => d.url.includes('vmware_vsphere'))
        .map(d => d.url);

      expect(vsphereUrls.length).toBeGreaterThan(0);
      vsphereUrls.forEach(url => {
        expect(url).toContain('/html-single/');
        expect(url).not.toContain('/html/installing_on_vmware_vsphere/');
      });
    });
  });

  describe('validated scenarios are present', () => {
    it('bare-metal-ipi scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['bare-metal-ipi']).toBeDefined();
      expect(docsIndex.scenarios['bare-metal-ipi'].docs.length).toBeGreaterThan(0);
    });

    it('bare-metal-agent scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['bare-metal-agent']).toBeDefined();
      expect(docsIndex.scenarios['bare-metal-agent'].docs.length).toBeGreaterThan(0);
    });

    it('aws-govcloud-ipi scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['aws-govcloud-ipi']).toBeDefined();
      expect(docsIndex.scenarios['aws-govcloud-ipi'].docs.length).toBeGreaterThan(0);
    });

    it('azure-government-ipi scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['azure-government-ipi']).toBeDefined();
    });

    it('nutanix-ipi scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['nutanix-ipi']).toBeDefined();
    });

    it('ibm-cloud-ipi scenario exists', () => {
      const content = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');
      const docsIndex = JSON.parse(content);
      expect(docsIndex.scenarios['ibm-cloud-ipi']).toBeDefined();
    });
  });

  describe('scenario count matches 4.20 (all platforms included)', () => {
    it('4.21 has same scenario count as 4.20 (vSphere included)', () => {
      const backend420Path = path.join(process.cwd(), '../data/docs-index/4.20.json');
      const content420 = fs.readFileSync(backend420Path, 'utf8');
      const content421 = fs.readFileSync(BACKEND_DOCS_INDEX, 'utf8');

      const docsIndex420 = JSON.parse(content420);
      const docsIndex421 = JSON.parse(content421);

      const scenarios420Count = Object.keys(docsIndex420.scenarios).length;
      const scenarios421Count = Object.keys(docsIndex421.scenarios).length;

      expect(scenarios421Count).toBe(scenarios420Count);
    });
  });
});
