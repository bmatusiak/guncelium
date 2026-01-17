import rectify from '@bmatusiak/rectify';

import gun from '../gun';
import moniker from '../moniker';
import tor from '../tor';

const config = [gun, tor, moniker];

const app = rectify.build(config);

export default app;
