import rectify from '@bmatusiak/rectify';

import gun from '../gun';
import gunClient from '../gunClient';
import moniker from '../moniker';
import tor from '../tor';

const config = [gun, gunClient, tor, moniker];

const app = rectify.build(config);

export default app;
