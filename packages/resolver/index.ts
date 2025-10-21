import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import diagnostics from 'diagnostics';
import Config, { type ConfigInstance } from '../config/index.ts';

const debug = diagnostics('oss-review:resolver');

/**
 * Runtime options for resolving configuration inputs.
 */
export interface ResolveOptions {
  /** Optional npm registry URL override. */
  registry?: string;
}

export interface ResolverCLIOptions extends ResolveOptions {
  config?: string[];
}

/**
 * Guarantee we always receive a Config instance from dynamic modules.
 *
 * @param module - Dynamic import result
 * @returns Config instance exported by the module
 * @throws Error when no Config instance is exported
 */
async function resolveConfigExport(module: unknown): Promise<ConfigInstance> {
  const record = module && typeof module === 'object' ? module as Record<string, unknown> : {};
  const candidates: unknown[] = [];
  candidates.push(record.default);
  candidates.push(record.config);
  candidates.push(record.Config);
  candidates.push(module);

  for (const candidate of candidates) {
    if (candidate instanceof Config) return candidate;
    if (typeof candidate === 'function') {
      const result = await candidate();
      if (result instanceof Config) return result;
    }
  }

  throw new Error('Unsupported config export. Expected Config instance.');
}

/**
 * Determine whether the provided spec should be treated as a path.
 *
 * @param input - CLI argument representing config source
 * @returns True when spec resolves to a filesystem path
 */
function isPathSpec(input: string): boolean {
  if (isAbsolute(input)) return true;
  if (input.startsWith('./') || input.startsWith('../')) return true;
  if (input.includes('@')) return false;

  const ext = extname(input).toLowerCase();
  if (ext === '.js' || ext === '.ts' || ext === '.json' || ext === '.mjs' || ext === '.cjs') return true;
  if ((input.includes('/') || input.includes('\\')) && ext.length > 0) return true;

  return false;
}

/**
 * Split npm package specifiers into name and optional version.
 *
 * @param spec - Package specifier with optional version suffix
 * @returns Parsed spec metadata
 */
function parseNpmSpec(spec: string): { name: string; version?: string } {
  if (spec.startsWith('@')) {
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return { name: spec };
  }

  const at = spec.indexOf('@');
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec };
}

/**
 * Safe asynchronous filesystem existence check.
 *
 * @param path - Absolute path to inspect
 * @returns Resolves true when accessible
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

/**
 * Detect package manager from lockfiles in the provided directory.
 *
 * @param dir - Directory to inspect (defaults to CWD)
 * @returns Package manager command name
 */
async function detect(dir: string = process.cwd()): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  debug('detecting package manager in %s', dir);

  if (await exists(resolve(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(resolve(dir, 'yarn.lock'))) return 'yarn';
  if (await exists(resolve(dir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/**
 * Delay execution for the specified number of milliseconds.
 *
 * @param ms - Milliseconds to wait
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>(function wait(resolveSleep) { setTimeout(resolveSleep, ms); });
}

/**
 * Poll for path existence within a timeout window.
 *
 * @param path - Path to watch
 * @param timeout - Total time to wait in milliseconds
 * @param interval - Polling interval in milliseconds
 * @returns True when path exists before timeout
 */
async function waitForPath(path: string, timeout: number = 5000, interval: number = 100): Promise<boolean> {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    if (await exists(path)) return true;
    await sleep(interval);
  }

  return false;
}

/**
 * Produce a stable alias for storing downloaded packages.
 *
 * @param name - Original package name
 * @param version - Optional version
 * @returns Normalised alias string
 */
function aliasFor(name: string, version?: string): string {
  const cleaned = name
    .replace(/^@/, '')
    .replace(/[\/]/g, '-')
    .replace(/\./g, '-')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-');
  return `oss-review-${cleaned}${version ? `-${version.replace(/\./g, '-')}` : ''}`;
}

/**
 * Construct npm alias specifications for package.json dependencies.
 *
 * @param name - Original package name
 * @param version - Optional version
 * @returns Alias specification string
 */
function aliasSpec(name: string, version?: string): string {
  return version ? `npm:${name}@${version}` : `npm:${name}`;
}

/**
 * Ensure the global config store exists and dependencies are declared.
 *
 * @param dep - Dependency metadata when ensuring a package
 * @returns Store directory metadata
 */
async function store(dep?: { alias: string; spec: string; version?: string }): Promise<{ dir: string; needsInstall: boolean }> {
  const root = resolve(homedir(), '.oss-review');

  debug('ensuring global store %s', root);
  await mkdir(root, { recursive: true });
  const pkgPath = resolve(root, 'package.json');

  let base: Record<string, any> = {
    name: 'oss-review-config-storage',
    private: true,
    dependencies: {}
  };

  let update = false;
  try {
    const text = await readFile(pkgPath, 'utf8');
    const { dependencies } = JSON.parse(text) as Record<string, any>;
    base.dependencies = dependencies || base.dependencies;
  } catch (err) {
    debug('creating new package.json for store');
    update = true;
  }

  let needsInstall = false;

  if (dep) {
    if (base.dependencies[dep.alias] !== dep.spec) {
      base.dependencies[dep.alias] = dep.spec;
      update = true;
      needsInstall = true;
    }

    const installedPkg = resolve(root, 'node_modules', dep.alias, 'package.json');
    try {
      const text = await readFile(installedPkg, 'utf8');
      const parsed = JSON.parse(text) as { version?: string };
      const current = typeof parsed.version === 'string' ? parsed.version : null;
      if (!current) needsInstall = true;
      else if (dep.version && dep.version !== current) needsInstall = true;
    } catch (e) {
      debug('no installed package.json, will install');
      needsInstall = true;
    }
  }

  if (update) await writeFile(pkgPath, JSON.stringify(base, null, 2), 'utf8');

  return { dir: root, needsInstall };
}

/**
 * Install a package specifier into the global store when necessary.
 *
 * @param spec - Package spec (e.g. name or name@version)
 * @param registry - Optional npm registry override
 * @returns Directory and alias information for resolving require
 */
async function install(spec: string, registry?: string): Promise<{ dir: string; alias: string }> {
  const { name, version } = parseNpmSpec(spec);
  const alias = aliasFor(name, version);
  const specString = aliasSpec(name, version);

  const { dir, needsInstall } = await store({ alias, spec: specString, version });
  if (!needsInstall) {
    debug('install skip %o', { alias, spec: specString, dir });
    return { dir, alias };
  }

  const manager = await detect(dir);
  const args = manager === 'npm'
    ? ['install']
    : manager === 'yarn'
      ? ['install', '--no-lockfile']
      : manager === 'pnpm'
        ? ['install']
        : ['install'];

  if (registry) args.push('--registry', registry);
  if (debug.enabled) args.push('--verbose');

  debug('install start %o', { manager, cwd: dir, alias, spec: specString, args });

  await new Promise<void>(function runInstall(resolveInstall, rejectInstall) {
    const child = spawn(manager, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    if (child.stdout) child.stdout.on('data', function onData(chunk: Buffer) {
      debug('%s', chunk.toString());
    });

    if (child.stderr) child.stderr.on('data', function onErr(chunk: Buffer) {
      debug('%s', chunk.toString());
    });

    child.on('error', rejectInstall);
    child.on('close', function onClose(code: number) {
      if (code === 0) {
        debug('install success alias=%s', alias);
        resolveInstall();
      } else {
        debug('install failed %o', { code, manager, cwd: dir, alias, spec: specString });
        rejectInstall(new Error(`Failed to install ${alias}@${specString} (exit code ${code})`));
      }
    });
  });

  const aliasPkg = resolve(dir, 'node_modules', alias, 'package.json');
  debug('waiting for installed package visibility', aliasPkg);

  if (!(await waitForPath(aliasPkg, 5000, 100))) {
    throw new Error(`Installed package not visible yet: ${aliasPkg}`);
  }

  return { dir, alias };
}

/**
 * Resolve a Config instance from an installed npm package.
 *
 * @param name - Package alias to resolve
 * @param req - Create require bound to store directory
 * @returns Config instance exported by package
 */
async function loadFromPackage(name: string, req: NodeJS.Require): Promise<ConfigInstance> {
  try {
    const mainPath = req.resolve(name);
    const module = await import(pathToFileURL(mainPath).href);
    return await resolveConfigExport(module);
  } catch (err) {
    debug('failed to load/import package', name, err);
    void err;
  }

  try {
    const pkgJsonPath = req.resolve(join(name, 'package.json'));
    const root = dirname(pkgJsonPath);
    const fallbackJs = resolve(root, 'oss-review-config.js');
    if (await exists(fallbackJs)) {
      const module = await import(pathToFileURL(fallbackJs).href);
      return await resolveConfigExport(module);
    }

    const fallbackJson = resolve(root, 'oss-review-config.json');
    if (await exists(fallbackJson)) {
      const text = await readFile(fallbackJson, 'utf8');
      const data = JSON.parse(text);
      if (data instanceof Config) return data;
    }
  } catch (err) {
    debug('failed to load fallback config', name, err);
    void err;
  }

  throw new Error(`Could not load config from package "${name}". Export a Config instance.`);
}

/**
 * Resolve a Config instance from a filesystem path.
 *
 * @param filePath - Absolute path to a module exporting Config
 * @returns Config instance provided by the module
 */
async function loadFromFile(filePath: string): Promise<ConfigInstance> {
  const ext = extname(filePath).toLowerCase().slice(1);
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts') {
    const module = await import(pathToFileURL(filePath).href);
    return await resolveConfigExport(module);
  }

  if (ext === 'json') {
    const text = await readFile(filePath, 'utf8');
    const data = JSON.parse(text);
    if (data instanceof Config) return data;
  }

  throw new Error(`Unsupported config file type: ${ext}. Expected module exporting Config.`);
}

/**
 * Merge multiple configuration instances with later entries overriding earlier ones.
 *
 * @param configs - Config instances to merge
 * @returns Combined configuration instance
 */
export function mergeConfigs(configs: ConfigInstance[]): ConfigInstance {
  if (configs.length === 0) return new Config();

  const merged = new Config();
  for (const config of configs) Object.assign(merged, config);
  return merged;
}

/**
 * Resolve configuration inputs into Config instances.
 *
 * @param inputs - CLI argument list of package names or file paths
 * @param options - Resolve behaviour options
 * @returns Array of Config instances, preserving the input order
 */
export async function resolveConfigs(inputs: string[], options: ResolveOptions = {}): Promise<ConfigInstance[]> {
  const resolved: ConfigInstance[] = [];
  const { registry } = options;

  debug('resolve config inputs %o', inputs);

  for (const input of inputs) {
    if (isPathSpec(input)) {
      const filePath = resolve(input);
      resolved.push(await loadFromFile(filePath));
      continue;
    }

    const { name, version } = parseNpmSpec(input);
    const spec = version ? `${name}@${version}` : name;

    const { dir, alias } = await install(spec, registry);
    const req = createRequire(resolve(dir, 'index.js'));
    resolved.push(await loadFromPackage(alias, req));
  }

  return resolved;
}