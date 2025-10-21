import { Config } from '../../../config/index.ts';

export default function createConfig() {
  return new Config({ id: 'factory', source: 'factory-export' });
}

