import { Config } from '../../../config/index.ts';

export const config = new Config({
  id: 'named',
  source: 'named-export',
  primary: false,
  shared: 'named'
});

export default new Config({
  id: 'default-from-named',
  source: 'default-export',
  primary: true,
  shared: 'default'
});

