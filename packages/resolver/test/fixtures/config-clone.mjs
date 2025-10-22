import { Config } from '../../../config/index.ts';

const basePrototype = Config.prototype;
const shadowPrototype = Object.create(null);

for (const name of Object.getOwnPropertyNames(basePrototype)) {
  if (name === 'constructor') continue;
  const descriptor = Object.getOwnPropertyDescriptor(basePrototype, name);
  if (descriptor) Object.defineProperty(shadowPrototype, name, descriptor);
}

class ShadowConfig {
  constructor(options = {}) {
    const base = new Config(options);
    Object.assign(this, base);
  }
}

Object.setPrototypeOf(ShadowConfig.prototype, shadowPrototype);

const config = new ShadowConfig({
  id: 'clone',
  source: 'shadow-export',
  resources: [],
  profile: { name: 'Shadow Org' }
});

export default config;

