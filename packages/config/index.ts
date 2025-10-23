/**
 * License categories supported by the OSS review configuration.
 */
export type LicenseCategory = 'green' | 'yellow' | 'red';

export interface LicenseEntry {
  /** SPDX identifier or descriptive license name. */
  id: string;
  /** Optional human readable display name. */
  name?: string;
  /** Optional notes clarifying usage constraints. */
  notes?: string;
  /** Upstream reference URL for the license text or policy. */
  url?: string;
}

export interface LicensePolicy {
  /**
   * Licenses that are approved for use without additional review.
   */
  green?: LicenseEntry[];
  /**
   * Licenses that are conditionally approved and require additional review or action.
   */
  yellow?: LicenseEntry[];
  /**
   * Licenses that are prohibited for use.
   */
  red?: LicenseEntry[];
}

export type DetectionConfig = Record<string, DetectionPattern[]>;

export interface ConfigOptions {
  /** Declared license policy grouped by category. */
  licenses?: LicensePolicy;
  /** Document resources required for release readiness. */
  resources?: ConfigResource[];
  /** Additional LLM instructions grouped by name. */
  instructions?: InstructionEntry[];
  /** Detection configuration for identifying sensitive references. */
  detection?: DetectionConfig;
  /** Profile information used for templating and documentation. */
  profile?: Profile;
  /** Arbitrary tool configuration keyed by tool name. */
  tools?: Record<string, unknown>;
  /** Allow storing additional configuration for future requirements. */
  [key: string]: unknown;
}

export interface ConfigResource {
  /** Display name of the resource (e.g. LICENSE). */
  name: string;
  /** Repository path to the resource file. */
  path: string;
}

export interface Profile {
  /** Public facing company name. */
  name?: string;
  /** Registered legal name if different. */
  legalName?: string;
  /** Primary website URL. */
  website?: string;
  /** Email for general inquiries. */
  contactEmail?: string;
  /** Email for security disclosures. */
  securityEmail?: string;
  /** Optional catch-all for additional fields. */
  [key: string]: string | undefined;
}

export interface InstructionEntry {
  /** Identifier for the instruction (e.g. readiness-overview). */
  name: string;
  /** Body of the instruction rendered to LLMs. */
  content: string;
  /** Optional short description summarising the instruction. */
  summary?: string;
}

export interface DetectionPattern {
  /** Unique identifier for the detection pattern. */
  id: string;
  /** Human friendly title explaining the purpose. */
  title?: string;
  /** Regex source string or glob depending on the type. */
  match: string;
  /** Type of detection: regex pattern, keyword list, or glob. */
  type?: 'regex' | 'keyword' | 'glob';
  /** Severity to inform triage priority. */
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Suggested remediation guidance. */
  remediation?: string;
  /** Optional list of categories for grouping (e.g. internal-url, secret). */
  categories?: string[];
  /** Optional codelink to documentation or playbooks. */
  reference?: string;
  /** Optional labels for filtering or routing. */
  tags?: string[];
}

export type DetectionBuckets = Record<string, DetectionPattern[]>;

/**
 * Configuration container for oss-review packages.
 */
export class Config {
  /** License policy definitions grouped by category. */
  public readonly licenses: LicensePolicy;
  /** Document resources linked to the configuration. */
  public readonly resources: ConfigResource[];
  /** Instruction catalogue made available to LLMs. */
  public readonly instructions: InstructionEntry[];
  /** Profile metadata for template rendering. */
  private readonly profileData: Profile;
  /** Detection configuration describing references to flag. */
  private readonly detectionBuckets: DetectionBuckets;
  /** Tool configuration keyed by tool name. */
  private readonly toolConfigs: Record<string, unknown>;

  /**
   * Create a configuration wrapper.
   *
   * @param options - Optional configuration inputs used to seed the instance
   */
  constructor(options: ConfigOptions = {}) {
    const { licenses = {}, resources = [], instructions = [], detection = {}, profile = {}, tools = {}, ...rest } = options;
    this.licenses = {
      green: [...(licenses.green ?? [])],
      yellow: [...(licenses.yellow ?? [])],
      red: [...(licenses.red ?? [])]
    };

    this.resources = resources.map((resource) => ({ ...resource }));
    this.instructions = instructions.map((instruction) => ({ ...instruction }));

    this.detectionBuckets = {};
    const detectionConfig = detection as DetectionConfig;
    for (const [bucket, patterns] of Object.entries(detectionConfig)) {
      this.detectionBuckets[bucket] = patterns.map((pattern) => ({ ...pattern }));
    }

    this.profileData = { ...profile };

    this.toolConfigs = {};
    Object.entries(tools as Record<string, unknown>).forEach(([name, settings]) => {
      if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed) this.toolConfigs[trimmed] = settings;
      }
    });

    Object.assign(this, rest);
  }

  /**
   * Retrieve licenses belonging to a specific category.
   *
   * @param category - License bucket to inspect
   * @returns A shallow copy of license entries for the requested category
   */
  getLicenses(category: LicenseCategory): LicenseEntry[] {
    return [...(this.licenses[category] ?? [])];
  }

  /**
   * Add or update a license entry inside the given category.
   *
   * Identifies entries by their `id`. If an entry with the same `id`
   * already exists it will be replaced; otherwise the entry is appended.
   *
   * @param category - License category bucket to update
   * @param entry - License entry to store in the category
   * @returns The current Config instance to support method chaining
   * @throws Error when the entry does not include a valid `id`
   */
  license(category: LicenseCategory, entry: LicenseEntry): this {
    if (!entry || typeof entry.id !== 'string') {
      throw new Error('License entry requires an "id" string.');
    }

    const id = entry.id.trim();
    if (!id) throw new Error('License entry requires a non-empty "id".');

    const bucket = this.licenses[category] ?? (this.licenses[category] = []);
    const normalized: LicenseEntry = { id };
    if (entry.name?.trim()) normalized.name = entry.name.trim();
    if (entry.notes?.trim()) normalized.notes = entry.notes.trim();
    if (entry.url?.trim()) normalized.url = entry.url.trim();

    checkAndSet(bucket, id, normalized, (value) => value.id);

    return this;
  }

  /**
   * Retrieve configured instructions.
   *
   * When a name is provided, only the matching instruction (if any) is
   * returned. Otherwise all instructions are returned.
   *
   * @returns A shallow copy of configured instructions or a single entry when name is supplied
   */
  getInstructions(): InstructionEntry[];
  getInstructions(name: string): InstructionEntry | undefined;
  getInstructions(name?: string): InstructionEntry[] | InstructionEntry | undefined {
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return undefined;

      const instruction = this.instructions.find((entry) => entry.name === trimmed);
      return instruction ? { ...instruction } : undefined;
    }

    return this.instructions.map((instruction) => ({ ...instruction }));
  }

  /**
   * Add or update an instruction body.
   *
   * @param name - Instruction identifier
   * @param content - Instruction body delivered to LLMs
   * @param summary - Optional summary for catalogues
   * @returns The current Config instance for chaining
   */
  instruction(name: string, content: string, summary?: string): this {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Instruction entry requires a non-empty "name".');
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Instruction entry requires a non-empty "content".');
    }

    const normalizedName = name.trim();
    const normalizedContent = content.trim();

    const normalized: InstructionEntry = { name: normalizedName, content: normalizedContent };
    if (summary?.trim()) normalized.summary = summary.trim();

    checkAndSet(this.instructions, normalizedName, normalized, (entry) => entry.name);

    return this;
  }

  /**
   * Store arbitrary configuration for a named tool.
   *
   * @param name - Tool identifier (e.g. secretlint)
   * @param settings - Configuration object passed to the tool at runtime
   * @returns The current Config instance for chaining
   */
  tool(name: string, settings: unknown): this {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Tool entry requires a non-empty "name".');
    }

    this.toolConfigs[name.trim()] = settings;
    return this;
  }

  /**
   * Retrieve configuration previously stored for the named tool.
   *
   * @param name - Tool identifier (e.g. secretlint)
   * @returns Cloned configuration object when present, otherwise undefined
   */
  getTool(name: string): unknown {
    if (typeof name !== 'string') return undefined;
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    return this.toolConfigs[trimmed];
  }

  /**
   * Retrieve detection configuration.
   *
   * @param bucket - Optional bucket name to retrieve
   * @returns Detection buckets or bucket entries when provided
   */
  getDetection(bucket?: string): DetectionBuckets | DetectionPattern[] {
    if (bucket) return this.detectionBuckets[bucket]?.map((pattern) => ({ ...pattern })) ?? [];
    return this.detectionBuckets;
  }

  /**
   * Add or update a detection pattern within a bucket.
   *
   * @param bucket - Detection bucket name (e.g. internal-refs)
   * @param pattern - Detection pattern definition
   * @returns The current Config instance for chaining
   */
  detectionPattern(bucket: string, pattern: DetectionPattern): this {
    if (typeof bucket !== 'string' || !bucket.trim()) {
      throw new Error('Detection bucket requires a non-empty name.');
    }

    if (!pattern || typeof pattern.id !== 'string' || !pattern.id.trim()) {
      throw new Error('Detection pattern requires a non-empty "id".');
    }

    if (typeof pattern.match !== 'string' || !pattern.match.trim()) {
      throw new Error('Detection pattern requires a non-empty "match" string.');
    }

    const normalized: DetectionPattern = {
      id: pattern.id.trim(),
      match: pattern.match,
      type: pattern.type ?? 'regex',
      severity: pattern.severity ?? 'medium'
    };

    if (pattern.title?.trim()) normalized.title = pattern.title.trim();
    if (pattern.remediation?.trim()) normalized.remediation = pattern.remediation.trim();
    if (pattern.categories?.length) normalized.categories = [...pattern.categories];
    if (pattern.reference?.trim()) normalized.reference = pattern.reference.trim();
    if (pattern.tags?.length) normalized.tags = [...pattern.tags];

    const name = bucket.trim();
    const patterns = this.detectionBuckets[name] ?? (this.detectionBuckets[name] = []);
    checkAndSet(patterns, normalized.id, normalized, (entry) => entry.id);

    return this;
  }

  /**
   * Retrieve all configured resources.
   *
   * @returns A shallow copy of configured resources
   */
  getResources(): ConfigResource[] {
    return [...this.resources];
  }

  /**
   * Add or update a resource definition.
   *
   * Resources are identified by their `name`. When a matching name exists the
   * path is updated; otherwise the resource is appended.
   *
   * @param name - Resource display name (e.g. LICENSE)
   * @param path - Repository path to the resource file
   * @returns The current Config instance for chaining
   */
  resource(name: string, path: string): this {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Resource entry requires a non-empty "name".');
    }

    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('Resource entry requires a non-empty "path".');
    }

    const normalizedName = name.trim();
    const normalizedPath = path.trim();

    checkAndSet(this.resources, normalizedName, { name: normalizedName, path: normalizedPath }, (resource) => {
      return resource.name;
    });

    return this;
  }

  /**
   * Retrieve the configured profile information.
   *
   * @returns A shallow copy of the stored profile
   */
  getProfile(): Profile {
    return { ...this.profileData };
  }

  /**
   * Retrieve a specific profile value.
   *
   * @param key - Field identifier
   * @returns Stored value when present, otherwise undefined
   */
  getProfileValue(key: string): string | undefined {
    return this.profileData[key];
  }

  /**
   * Add or update a profile field entry.
   *
   * @param key - Profile field identifier (e.g. name, website)
   * @param value - Value assigned to the profile field
   * @returns The current Config instance for chaining
   */
  profileField(key: string, value: string): this {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Company profile entry requires a non-empty "key".');
    }

    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Company profile entry requires a non-empty "value".');
    }

    this.profileData[key.trim()] = value.trim();
    return this;
  }

  /**
   * Merge profile information with the existing profile store.
   *
   * @param details - Profile fields to assign
   * @returns The current Config instance for chaining
   */
  mergeProfile(details: Profile): this {
    Object.entries(details).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        this.profileData[key] = value.trim();
      }
    });

    return this;
  }
}

/**
 * Insert or replace an entry in an array keyed by identifier.
 *
 * @param list - Target array to update
 * @param id - Identifier used for comparison
 * @param value - Value to insert when id is new
 * @param getId - Optional extractor when array items do not expose `id`
 */
function checkAndSet<T>(
  list: T[],
  id: string,
  value: T,
  getId: (item: T) => string = (item: any) => String(item.id ?? '')
): void {
  const identifier = id.trim();
  const index = list.findIndex((item) => getId(item) === identifier);

  if (index === -1) list.push(value);
  else list[index] = value;
}

export type ConfigInstance = Config;

export default Config;

