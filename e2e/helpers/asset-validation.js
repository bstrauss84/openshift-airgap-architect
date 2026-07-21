import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(process.cwd());
const PARAMS_DIR = path.join(REPO_ROOT, 'data', 'params');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'docs', 'e2e-examples');
const ASSETS_DIR = path.join(REPO_ROOT, 'e2e-results', 'generated-assets');

const EMITTABLE_STATUSES = new Set([
  'supported-ui',
  'supported-derived',
  'supported-backend-only',
  'deprecated-supported',
]);

export function loadCatalogParams(version, scenarioId) {
  const filePath = path.join(PARAMS_DIR, version, `${scenarioId}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return data.parameters || [];
}

export function getRequiredParams(params, outputFile) {
  return params.filter(
    (p) =>
      p.required === true &&
      p.outputFile === outputFile &&
      EMITTABLE_STATUSES.has(p.supportStatus)
  );
}

export function getParamsByFile(params, outputFile) {
  return params.filter(
    (p) => p.outputFile === outputFile && EMITTABLE_STATUSES.has(p.supportStatus)
  );
}

export function resolveYamlPath(obj, catalogPath) {
  if (obj == null || typeof obj !== 'object') return { found: false, value: undefined };
  const segments = catalogPath.split('.');
  return walkSegments(obj, segments, 0);
}

function walkSegments(obj, segments, idx) {
  if (idx >= segments.length) return { found: true, value: obj };
  if (obj == null || typeof obj !== 'object') return { found: false, value: undefined };

  let seg = segments[idx];
  const isArraySeg = seg.endsWith('[]');
  if (isArraySeg) seg = seg.slice(0, -2);

  if (!(seg in obj)) return { found: false, value: undefined };
  const child = obj[seg];

  if (isArraySeg) {
    if (idx === segments.length - 1) return { found: true, value: child };
    const arr = Array.isArray(child) ? child : [child];
    for (const elem of arr) {
      const result = walkSegments(elem, segments, idx + 1);
      if (result.found) return result;
    }
    return { found: false, value: undefined };
  }

  return walkSegments(child, segments, idx + 1);
}

export function checkRequiredFields(parsedYaml, requiredParams) {
  const present = [];
  const missing = [];
  for (const param of requiredParams) {
    const result = resolveYamlPath(parsedYaml, param.path);
    if (result.found && result.value != null) {
      present.push(param.path);
    } else {
      missing.push(param.path);
    }
  }
  return { present, missing };
}

const JS_TYPE_MAP = {
  string: 'string',
  integer: 'number',
  int: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  cidr: 'string',
  ipv4: 'string',
  ipv6: 'string',
};

export function checkValueTypes(parsedYaml, params) {
  const correct = [];
  const mismatched = [];
  for (const param of params) {
    const result = resolveYamlPath(parsedYaml, param.path);
    if (!result.found || result.value == null) continue;

    const catalogType = param.type;
    const actualValue = result.value;

    if (catalogType === 'array') {
      if (Array.isArray(actualValue)) {
        correct.push({ path: param.path, expected: 'array', actual: 'array' });
      } else {
        mismatched.push({ path: param.path, expected: 'array', actual: typeof actualValue });
      }
    } else if (catalogType === 'object') {
      if (typeof actualValue === 'object' && !Array.isArray(actualValue)) {
        correct.push({ path: param.path, expected: 'object', actual: 'object' });
      } else {
        mismatched.push({ path: param.path, expected: 'object', actual: typeof actualValue });
      }
    } else {
      const expectedJsType = JS_TYPE_MAP[catalogType];
      if (expectedJsType && typeof actualValue === expectedJsType) {
        correct.push({ path: param.path, expected: catalogType, actual: typeof actualValue });
      } else if (expectedJsType) {
        mismatched.push({ path: param.path, expected: catalogType, actual: typeof actualValue });
      }
    }
  }
  return { correct, mismatched };
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function compareKeyStructure(generated, reference, pathPrefix = '') {
  const missing = [];
  const extra = [];

  if (!isPlainObject(generated) || !isPlainObject(reference)) return { missing, extra };

  const refKeys = Object.keys(reference);
  const genKeys = Object.keys(generated);
  const refSet = new Set(refKeys);
  const genSet = new Set(genKeys);

  for (const k of refKeys) {
    const fullPath = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (!genSet.has(k)) {
      missing.push(fullPath);
    } else if (isPlainObject(reference[k]) && isPlainObject(generated[k])) {
      const sub = compareKeyStructure(generated[k], reference[k], fullPath);
      missing.push(...sub.missing);
      extra.push(...sub.extra);
    } else if (
      Array.isArray(reference[k]) &&
      Array.isArray(generated[k]) &&
      reference[k].length > 0 &&
      generated[k].length > 0
    ) {
      if (isPlainObject(reference[k][0]) && isPlainObject(generated[k][0])) {
        const sub = compareKeyStructure(generated[k][0], reference[k][0], `${fullPath}[0]`);
        missing.push(...sub.missing);
        extra.push(...sub.extra);
      }
    }
  }

  for (const k of genKeys) {
    const fullPath = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (!refSet.has(k)) {
      extra.push(fullPath);
    }
  }

  return { missing, extra };
}

export function loadReferenceYaml(subdir, filename) {
  const filePath = path.join(EXAMPLES_DIR, subdir, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw);
}

export function parseYaml(yamlString) {
  return yaml.load(yamlString);
}

export function writeGeneratedAssets(files, scenarioId, version, variant = 'minimal') {
  const dir = path.join(ASSETS_DIR, version, `${scenarioId}_${variant}`);
  fs.mkdirSync(dir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    if (content && typeof content === 'string') {
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
    }
  }
  return dir;
}

export function makeVersionedFixture(scenarioFn, minor, patch) {
  const fixture = scenarioFn();
  fixture.release.channel = minor;
  fixture.release.patchVersion = patch;
  fixture.version.selectedChannel = `stable-${minor}`;
  fixture.version.selectedVersion = patch;
  return fixture;
}

export const SUPPORTED_VERSIONS = [
  { minor: '4.20', patch: '4.20.0' },
  { minor: '4.21', patch: '4.21.0' },
];

export const SCENARIO_MAP = [
  { id: 'bare-metal-agent', fn: 'bareMetalAgent', hasAgentConfig: true },
  { id: 'bare-metal-ipi', fn: 'bareMetalIpi', hasAgentConfig: false },
  { id: 'bare-metal-upi', fn: 'bareMetalUpi', hasAgentConfig: false },
  { id: 'vsphere-ipi', fn: 'vsphereIpi', hasAgentConfig: false },
  { id: 'vsphere-upi', fn: 'vsphereUpi', hasAgentConfig: false },
  { id: 'vsphere-agent', fn: 'vsphereAgent', hasAgentConfig: true },
  { id: 'nutanix-ipi', fn: 'nutanixIpi', hasAgentConfig: false },
  { id: 'aws-govcloud-ipi', fn: 'awsGovcloudIpi', hasAgentConfig: false },
  { id: 'aws-govcloud-upi', fn: 'awsGovcloudUpi', hasAgentConfig: false },
  { id: 'azure-government-ipi', fn: 'azureGovernmentIpi', hasAgentConfig: false },
  { id: 'azure-government-upi', fn: 'azureGovernmentUpi', hasAgentConfig: false },
  { id: 'ibm-cloud-ipi', fn: 'ibmCloudIpi', hasAgentConfig: false },
];
