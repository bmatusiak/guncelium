import rectify from '@bmatusiak/rectify';

import gun from '../gun';
import tor from '../tor';

const config = [gun, tor];

const app = rectify.build(config);

export default app;
