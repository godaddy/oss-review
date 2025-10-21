/**
 * Configuration container for oss-review packages.
 */
export class Config {
  /**
   * Create a configuration wrapper.
   */
  constructor(options: Record<string, unknown> = {}) {
    Object.assign(this, options);
  }
}

export type ConfigInstance = Config;

export default Config;


